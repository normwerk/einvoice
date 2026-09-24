/**
 * P-63: `POST /admin/orders/:id/einvoice/refusals/:refusalId/retry` — issues a document the plugin refused,
 * after the merchant corrected the order or the shop's settings. The fulfillment event that would have
 * issued it does not come again, so without this a blocked invoice is never issued. Runs the same
 * `issueInvoiceForFulfillment` as the subscriber, checks included: a retry that is still blocked updates the
 * refusal and says why. Admin only, like the list route next to it.
 */
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { EINVOICE_MODULE } from "../../../../../../../../modules/einvoice/index.js";
import type EinvoiceModuleService from "../../../../../../../../modules/einvoice/service.js";
import type { EinvoiceRefusalRecord } from "../../../../../../../../modules/einvoice/service.js";
import { issueInvoiceForFulfillment } from "../../../../../../../../invoices/issue-invoice.js";

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
  if (refusal.type !== "invoice") {
    res
      .status(400)
      .json({ message: `Refusal ${refusalId} is not for an invoice; it cannot be retried.` });
    return;
  }

  let outcome: Awaited<ReturnType<typeof issueInvoiceForFulfillment>>;
  try {
    outcome = await issueInvoiceForFulfillment(req.scope, {
      orderId,
      fulfillmentId: refusal.idempotency_key,
    });
  } catch (error) {
    // A refusal of another kind — a missing fact, an undecidable VAT category: the message says which.
    res.status(422).json({ message: error instanceof Error ? error.message : String(error) });
    return;
  }

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
  }
}
