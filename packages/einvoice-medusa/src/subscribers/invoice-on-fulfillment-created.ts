/**
 * T-071: `order.fulfillment_created` → the invoice for that fulfillment, issued by
 * `issueInvoiceForFulfillment` (`invoices/issue-invoice.ts`, which carries the whole story: idempotency,
 * numbering, the Webbers and standalone PDF paths, file storage, and the P-63 check against what Medusa
 * charged). Event name and payload shape verified against `@medusajs/utils@2.19.0`'s own compiled
 * `OrderWorkflowEvents.FULFILLMENT_CREATED` (T-070, `docs/domain-glossary.md`) —
 * `{ order_id, fulfillment_id, no_notification }`.
 *
 * An invoice the check blocks is recorded as a refusal and the event is still handled: redelivering it
 * would only block again, and the admin widget offers the retry once the order is corrected.
 */
import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework";
import { issueInvoiceForFulfillment } from "../invoices/issue-invoice.js";

interface FulfillmentCreatedEventData {
  readonly order_id: string;
  readonly fulfillment_id: string;
  readonly no_notification?: boolean | null;
}

export default async function invoiceOnFulfillmentCreated({
  event: { data },
  container,
}: SubscriberArgs<FulfillmentCreatedEventData>): Promise<void> {
  await issueInvoiceForFulfillment(container, {
    orderId: data.order_id,
    fulfillmentId: data.fulfillment_id,
  });
}

export const config: SubscriberConfig = {
  event: "order.fulfillment_created",
};
