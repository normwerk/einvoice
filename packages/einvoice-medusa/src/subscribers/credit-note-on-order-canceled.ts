/**
 * P-41: `order.canceled` → a credit note for whatever is still outstanding on the order's invoices.
 *
 * Medusa only cancels an order once all its fulfillments are cancelled — so an order this plugin invoiced
 * (on `order.fulfillment_created`) and that is then cancelled still carries that invoice, and it must be
 * corrected whether or not money was ever captured. `cancelOrderWorkflow` (`@medusajs/core-flows` 2.19)
 * refunds captured payments through `refundCapturedPaymentsWorkflow`, which does **not** emit
 * `payment.refunded` — so before this subscriber a cancelled, invoiced order got no credit note at all. The
 * event carries `{ id }`, the order's id (`OrderWorkflowEvents.CANCELED`, same source).
 *
 * P-67: each fulfillment has its own invoice, and cancelling a fulfillment credits its invoice
 * (`credit-note-on-fulfillment-canceled.ts`) — so by the time the order is cancelled, its invoices are
 * normally credited already. This subscriber credits what is left of any invoice whose fulfillment is still
 * standing, one credit note per invoice; an invoice of a cancelled fulfillment is that subscriber's, so the
 * two never credit the same invoice at once. Never more than an invoice, even if a `payment.refunded` for
 * the same money is handled too (`decideCreditScope`).
 */
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework";
import { EINVOICE_MODULE } from "../modules/einvoice/index.js";
import type EinvoiceModuleService from "../modules/einvoice/service.js";
import {
  ORDER_QUERY_FIELDS,
  type MedusaOrderForInvoice,
} from "../mapping/order-to-commerce-invoice-input.js";
import { creditInvoiceRemainder, listOrderInvoices } from "../credit-notes/issue-credit-note.js";
import { standingInvoices } from "../invoices/issue-invoice.js";

interface OrderCanceledEventData {
  readonly id: string;
}

export default async function creditNoteOnOrderCanceled({
  event: { data },
  container,
}: SubscriberArgs<OrderCanceledEventData>): Promise<void> {
  const einvoiceService = container.resolve<EinvoiceModuleService>(EINVOICE_MODULE);

  // P-66: a cancelled order needs no invoice — a refused one is no longer to be retried.
  await einvoiceService.clearRefusalsOfOrder("invoice", data.id);

  const invoices = await listOrderInvoices(einvoiceService, data.id);
  if (invoices.length === 0) {
    // Cancelled before it was ever invoiced — nothing to correct.
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

  for (const invoice of standingInvoices(order, invoices)) {
    await creditInvoiceRemainder(container, einvoiceService, order, invoice, {
      idempotencyKey: `order.canceled:${invoice.id}`,
      trigger: { event: "order.canceled" },
    });
  }
}

export const config: SubscriberConfig = {
  event: "order.canceled",
};
