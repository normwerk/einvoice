/**
 * T-071: one row per e-invoice XML this plugin has generated for a Medusa order — the actual idempotency
 * guard "повторная доставка события не создаёт второй документ" (plan-v0.1 §9, W10's own acceptance
 * criterion) rests on, not an application-level "check, then insert" (which races: two concurrent
 * deliveries of the same event could both pass the check before either writes). `type` + `idempotency_key`
 * together carry a real Postgres `UNIQUE` index (`.indexes([...])` below) — a second insert with the same
 * pair fails at the database, and `service.ts`'s `recordDocumentIfAbsent` treats that failure itself as
 * the "already handled, no-op" signal, the same class of guarantee `docs/domain-glossary.md`'s Medusa v2
 * section documents for `display_id` (a real Postgres `SERIAL`, not application-level counting).
 *
 * `idempotency_key` is `<fulfillment id>` for an invoice, `<payment id>` for a credit note — deliberately
 * not the order id alone: a single order can have more than one fulfillment (partial shipments) or more
 * than one refunded payment, and each of those must be able to produce its own document.
 *
 * `xml` is stored inline as a Postgres text column, not in the File Module — T-074 is the task that
 * actually designs and wires file storage (admin "Download e-invoice" widget, Store API endpoint); a text
 * column here answers this task's own two questions ("has this already been generated" and "hand back the
 * bytes when it has") honestly, without guessing at a storage design that belongs to a later task.
 */
import { model } from "@medusajs/framework/utils";

const EinvoiceDocument = model
  .define("EinvoiceDocument", {
    id: model.id({ prefix: "einvdoc" }).primaryKey(),
    type: model.enum(["invoice", "credit_note"]),
    order_id: model.text(),
    idempotency_key: model.text(),
    document_number: model.text(),
    xml: model.text(),
  })
  .indexes([{ on: ["type", "idempotency_key"], unique: true }]);

export default EinvoiceDocument;
