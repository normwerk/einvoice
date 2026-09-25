/**
 * P-67 (M-045): `order.fulfillment_canceled` → a credit note for the invoice of that fulfillment. Each
 * fulfillment is invoiced on its own; when it is cancelled — before it ships, Medusa allows nothing else —
 * the supply did not happen, and its invoice is corrected in full: restated when nothing was credited before,
 * otherwise what is left of it. Its units go back to the order's unfulfilled items and are invoiced again when
 * they ship in another fulfillment.
 *
 * The event carries `{ order_id, fulfillment_id, no_notification }` (`OrderWorkflowEvents.FULFILLMENT_CANCELED`,
 * emitted by `cancelOrderFulfillmentWorkflow`, checked in `@medusajs/core-flows` 2.19). A fulfillment whose
 * invoice was refused has nothing to correct; its refusal is dropped instead.
 */
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework";
import { EINVOICE_MODULE } from "../modules/einvoice/index.js";
import type EinvoiceModuleService from "../modules/einvoice/service.js";
import type { EinvoiceDocumentRecord } from "../modules/einvoice/service.js";
import {
  ORDER_QUERY_FIELDS,
  type MedusaOrderForInvoice,
} from "../mapping/order-to-commerce-invoice-input.js";
import { creditInvoiceRemainder } from "../credit-notes/issue-credit-note.js";

interface FulfillmentCanceledEventData {
  readonly order_id: string;
  readonly fulfillment_id: string;
}

export default async function creditNoteOnFulfillmentCanceled({
  event: { data },
  container,
}: SubscriberArgs<FulfillmentCanceledEventData>): Promise<void> {
  const einvoiceService = container.resolve<EinvoiceModuleService>(EINVOICE_MODULE);

  // A cancelled fulfillment is not invoiced — a refused invoice for it is no longer to be retried.
  await einvoiceService.clearRefusal("invoice", data.fulfillment_id);

  const invoice = (
    (await einvoiceService.listEinvoiceDocuments({
      type: "invoice",
      idempotency_key: data.fulfillment_id,
    })) as unknown as EinvoiceDocumentRecord[]
  )[0];
  if (invoice === undefined) {
    return;
  }

  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const { data: orders } = await query.graph({
    entity: "order",
    filters: { id: data.order_id },
    fields: ORDER_QUERY_FIELDS as unknown as string[],
  });
  const order = orders[0] as MedusaOrderForInvoice | undefined;
  if (order === undefined) {
    return;
  }

  await creditInvoiceRemainder(container, einvoiceService, order, invoice, {
    idempotencyKey: `fulfillment.canceled:${data.fulfillment_id}`,
    trigger: {
      event: "order.fulfillment_canceled",
      orderId: data.order_id,
      fulfillmentId: data.fulfillment_id,
    },
  });
}

export const config: SubscriberConfig = {
  event: "order.fulfillment_canceled",
};
