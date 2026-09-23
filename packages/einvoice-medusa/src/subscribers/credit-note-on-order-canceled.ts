/**
 * P-41: `order.canceled` → a credit note for whatever is still outstanding on the order's invoice.
 *
 * Medusa only cancels an order once all its fulfillments are cancelled — so an order this plugin invoiced
 * (on `order.fulfillment_created`) and that is then cancelled still carries that invoice, and it must be
 * corrected whether or not money was ever captured. `cancelOrderWorkflow` (`@medusajs/core-flows` 2.19)
 * refunds captured payments through `refundCapturedPaymentsWorkflow`, which does **not** emit
 * `payment.refunded` — so before this subscriber a cancelled, invoiced order got no credit note at all. The
 * event carries `{ id }`, the order's id (`OrderWorkflowEvents.CANCELED`, same source).
 *
 * Credits everything outstanding: the whole order when nothing was credited before, otherwise one line over
 * the rest (`decideCreditScope`) — never more than the invoice, even if a `payment.refunded` for the same
 * money is handled too. Not in `@webbers/invoices-medusa` mode: their plugin issues no credit invoice on
 * cancellation, and this plugin never allocates its own number in that mode; a warning is logged instead.
 */
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework";
import { EINVOICE_MODULE } from "../modules/einvoice/index.js";
import type EinvoiceModuleService from "../modules/einvoice/service.js";
import {
  ORDER_QUERY_FIELDS,
  type MedusaOrderForInvoice,
} from "../mapping/order-to-commerce-invoice-input.js";
import { decideCreditScope } from "../mapping/credit-note.js";
import {
  creditTolerance,
  issueCreditNote,
  loadCreditBasis,
} from "../credit-notes/issue-credit-note.js";

interface OrderCanceledEventData {
  readonly id: string;
}

export default async function creditNoteOnOrderCanceled({
  event: { data },
  container,
}: SubscriberArgs<OrderCanceledEventData>): Promise<void> {
  const einvoiceService = container.resolve<EinvoiceModuleService>(EINVOICE_MODULE);
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);

  const idempotencyKey = `order.canceled:${data.id}`;
  const existing = await einvoiceService.listEinvoiceDocuments({
    type: "credit_note",
    idempotency_key: idempotencyKey,
  });
  if (existing.length > 0) {
    return;
  }

  const basis = await loadCreditBasis(container, einvoiceService, data.id);
  if (basis === undefined) {
    // Cancelled before it was ever invoiced — nothing to correct.
    return;
  }

  if (einvoiceService.options.integration?.kind === "webbers") {
    logger.warn(
      `einvoice: order ${data.id} was cancelled after its e-invoice was issued; in @webbers/invoices-medusa ` +
        "mode this plugin issues no credit note for a cancellation — issue it yourself.",
    );
    return;
  }

  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const { data: orders } = await query.graph({
    entity: "order",
    filters: { id: data.id },
    fields: ORDER_QUERY_FIELDS as unknown as string[],
  });
  const order = orders[0] as MedusaOrderForInvoice | undefined;
  if (order === undefined) {
    return;
  }

  const scope = decideCreditScope({
    requested: basis.invoiceTotal,
    invoiceTotal: basis.invoiceTotal,
    creditedTotals: basis.creditedTotals,
    tolerance: creditTolerance(order),
  });
  if (scope.kind === "none") {
    return;
  }
  await issueCreditNote({
    container,
    einvoiceService,
    order,
    basis,
    scope,
    idempotencyKey,
    reason: "cancellation",
  });
}

export const config: SubscriberConfig = {
  event: "order.canceled",
};
