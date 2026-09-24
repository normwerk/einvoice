/**
 * P-63 (M-043): a document this plugin decided not to issue, and why — one row per `(type,
 * idempotency_key)`, the same key the document itself would carry (`einvoice-document.ts`). Written when
 * the invoice disagrees with what Medusa charged in a way the plugin must not issue
 * (`InvoiceBlock`, `mapping/charged-reconciliation.ts`); `code` is the block's code and `details` its
 * amounts. The admin widget lists these next to the documents, with a manual retry
 * (`POST /admin/orders/:id/einvoice/refusals/:refusalId/retry`): the fulfillment event that would have
 * issued the invoice does not come again. Deleted once the document is issued.
 *
 * `type` already allows credit notes, and `code` is free text, so other refusals can be recorded here too
 * (T-077); today only the invoice check writes rows.
 */
import { model } from "@medusajs/framework/utils";

const EinvoiceRefusal = model
  .define("EinvoiceRefusal", {
    id: model.id({ prefix: "einvref" }).primaryKey(),
    type: model.enum(["invoice", "credit_note"]),
    order_id: model.text(),
    idempotency_key: model.text(),
    code: model.text(),
    details: model.json(),
  })
  .indexes([{ on: ["type", "idempotency_key"], unique: true }]);

export default EinvoiceRefusal;
