/**
 * T-201: `order-edit.confirmed` → a notice on each invoice whose price an order edit changed after it was
 * issued (`mapping/price-change.ts`). The invoice itself is not corrected: a lowered price is credited when the
 * difference is refunded; a raised one is invoiced outside the plugin.
 *
 * Medusa emits `{ order_id, actions }` (`confirmOrderEditRequestWorkflow`, `@medusajs/core-flows` 2.19); only
 * `order_id` is read. The order's confirmed edits are read back through Query (`order_change`,
 * `change_type: "edit"`) and every invoice's notices are worked out anew — so a redelivered event changes
 * nothing, and an edit back to the invoiced price takes its notice away.
 */
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework";
import { EINVOICE_MODULE } from "../modules/einvoice/index.js";
import type EinvoiceModuleService from "../modules/einvoice/service.js";
import type { EinvoiceDocumentRecord } from "../modules/einvoice/service.js";
import { priceNotices, type MedusaOrderEditChange } from "../mapping/price-change.js";

interface OrderEditConfirmedEventData {
  readonly order_id: string;
}

export default async function priceNoticeOnOrderEditConfirmed({
  event: { data },
  container,
}: SubscriberArgs<OrderEditConfirmedEventData>): Promise<void> {
  const einvoiceService = container.resolve<EinvoiceModuleService>(EINVOICE_MODULE);
  const invoices = (await einvoiceService.listEinvoiceDocuments({
    type: "invoice",
    order_id: data.order_id,
  })) as unknown as EinvoiceDocumentRecord[];
  if (invoices.length === 0) return;

  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const { data: edits } = await query.graph({
    entity: "order_change",
    filters: { order_id: data.order_id, change_type: "edit", status: "confirmed" },
    fields: ["id", "confirmed_at", "actions.action", "actions.details"],
  });
  for (const invoice of invoices) {
    const notices = priceNotices(invoice, edits as unknown as MedusaOrderEditChange[]);
    if (notices.length === 0 && (invoice.price_notices ?? []).length === 0) continue;
    await einvoiceService.setPriceNotices(invoice.id, notices);
    if (notices.length > 0) {
      container
        .resolve(ContainerRegistrationKeys.LOGGER)
        .warn(
          `einvoice: order ${data.order_id}: invoice ${invoice.document_number} — ` +
            `${notices.length} price(s) changed after it was issued [PRICE_CHANGED_AFTER_INVOICE]`,
        );
    }
  }
}

export const config: SubscriberConfig = {
  event: "order-edit.confirmed",
};
