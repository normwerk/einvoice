/**
 * P-63/P-66: `POST /admin/orders/:id/einvoice/refusals/:refusalId/retry` — issues a document the plugin did
 * not issue, after the merchant corrected the order or the shop's settings, or once VIES answers again. The
 * event that would have issued it does not come again, so without this a refused document is never issued.
 *
 * An invoice runs the same `issueInvoiceForFulfillment` as the fulfillment subscriber, checks included. A
 * credit note redelivers the event its refusal names (`details.event`, `refusals.ts`) to the same subscriber
 * — every refund of that payment, or the cancellation — which is idempotent, and then reports what the
 * refusal's key has now: a credit note, a refusal again, or neither (nothing left to credit). Admin only,
 * like the list route next to it.
 */
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import type { SubscriberArgs } from "@medusajs/framework";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { EINVOICE_MODULE } from "../../../../../../../../modules/einvoice/index.js";
import type EinvoiceModuleService from "../../../../../../../../modules/einvoice/service.js";
import type {
  EinvoiceDocumentRecord,
  EinvoiceRefusalRecord,
} from "../../../../../../../../modules/einvoice/service.js";
import { issueInvoiceForFulfillment } from "../../../../../../../../invoices/issue-invoice.js";
import { describeRefusal } from "../../../../../../../../refusals.js";
import { errorForLog } from "../../../../../../../../errors.js";
import creditNoteOnPaymentRefunded from "../../../../../../../../subscribers/credit-note-on-payment-refunded.js";
import creditNoteOnOrderCanceled from "../../../../../../../../subscribers/credit-note-on-order-canceled.js";
import creditNoteOnFulfillmentCanceled from "../../../../../../../../subscribers/credit-note-on-fulfillment-canceled.js";

/** Redelivers the event a credit note's refusal names; `false` when it names none. */
async function redeliver(req: MedusaRequest, refusal: EinvoiceRefusalRecord): Promise<boolean> {
  const event = refusal.details["event"];
  const paymentId = refusal.details["paymentId"];
  if (event === "payment.refunded" && typeof paymentId === "string") {
    await creditNoteOnPaymentRefunded({
      event: { name: event, data: { id: paymentId } },
      container: req.scope,
      pluginOptions: {},
    } as unknown as SubscriberArgs<{ id: string }>);
    return true;
  }
  if (event === "order.canceled") {
    await creditNoteOnOrderCanceled({
      event: { name: event, data: { id: refusal.order_id } },
      container: req.scope,
      pluginOptions: {},
    } as unknown as SubscriberArgs<{ id: string }>);
    return true;
  }
  const fulfillmentId = refusal.details["fulfillmentId"];
  if (event === "order.fulfillment_canceled" && typeof fulfillmentId === "string") {
    await creditNoteOnFulfillmentCanceled({
      event: {
        name: event,
        data: { order_id: refusal.order_id, fulfillment_id: fulfillmentId },
      },
      container: req.scope,
      pluginOptions: {},
    } as unknown as SubscriberArgs<{ order_id: string; fulfillment_id: string }>);
    return true;
  }
  return false;
}

async function retryCreditNote(
  req: MedusaRequest,
  res: MedusaResponse,
  einvoiceService: EinvoiceModuleService,
  refusal: EinvoiceRefusalRecord,
): Promise<void> {
  if (!(await redeliver(req, refusal))) {
    res.status(400).json({ message: `Refusal ${refusal.id} names no event to redeliver.` });
    return;
  }
  const key = { type: "credit_note" as const, idempotency_key: refusal.idempotency_key };
  const document = (
    (await einvoiceService.listEinvoiceDocuments(key)) as unknown as EinvoiceDocumentRecord[]
  )[0];
  if (document !== undefined) {
    res.status(200).json({ outcome: "issued", documentNumber: document.document_number });
    return;
  }
  const again = (
    (await einvoiceService.listEinvoiceRefusals(key)) as unknown as EinvoiceRefusalRecord[]
  )[0];
  if (again !== undefined) {
    res.status(200).json({ outcome: "blocked", code: again.code, message: describeRefusal(again) });
    return;
  }
  // Nothing refused and nothing issued: nothing is left to credit (the invoice is fully credited already).
  await einvoiceService.clearRefusal("credit_note", refusal.idempotency_key);
  res.status(200).json({ outcome: "none" });
}

export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const orderId = req.params["id"] as string;
  const refusalId = req.params["refusalId"] as string;
  const einvoiceService = req.scope.resolve<EinvoiceModuleService>(EINVOICE_MODULE);
  const refusal = (
    (await einvoiceService.listEinvoiceRefusals({
      id: refusalId,
      order_id: orderId,
    })) as unknown as EinvoiceRefusalRecord[]
  )[0];
  if (refusal === undefined) {
    res.status(404).json({ message: `No refused e-invoice ${refusalId} for order ${orderId}.` });
    return;
  }

  try {
    if (refusal.type === "credit_note") {
      await retryCreditNote(req, res, einvoiceService, refusal);
      return;
    }
    const outcome = await issueInvoiceForFulfillment(req.scope, {
      orderId,
      fulfillmentId: refusal.idempotency_key,
    });
    switch (outcome.kind) {
      case "issued":
        res.status(200).json({
          outcome: "issued",
          documentNumber: outcome.documentNumber,
          noticeCode: outcome.notice?.code ?? null,
        });
        return;
      case "blocked":
        res.status(200).json({
          outcome: "blocked",
          code: outcome.refusal.code,
          message: outcome.message,
        });
        return;
      case "exists":
        await einvoiceService.clearRefusal("invoice", refusal.idempotency_key);
        res.status(200).json({ outcome: "exists" });
        return;
      case "order-missing":
        res.status(404).json({ message: `Order ${orderId} no longer exists.` });
        return;
      case "fulfillment-canceled":
        res.status(200).json({ outcome: "none" });
        return;
    }
  } catch (error) {
    // Refusals are outcomes; what is thrown failed after them — storage, the database, the file module. The
    // admin gets the message; the log, which would otherwise not hear of it, the class (`errorForLog`).
    req.scope
      .resolve(ContainerRegistrationKeys.LOGGER)
      .error(
        `einvoice: order ${orderId}: the retry of refusal ${refusalId} failed — ${errorForLog(error)}`,
      );
    res.status(500).json({ message: error instanceof Error ? error.message : String(error) });
  }
}
