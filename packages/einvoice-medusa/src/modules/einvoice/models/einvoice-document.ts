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
 * `idempotency_key` is `<fulfillment id>` for an invoice, `<refund id>` for a credit note (T-072 corrected
 * this from an earlier `<payment id>` — a single payment can carry more than one partial refund, each
 * needing its own credit note, the same real per-item granularity `@webbers/invoices-medusa`'s own
 * `create-credit-invoice` workflow uses, `resource_id: refund.id` — confirmed by reading their published
 * source, not assumed) — deliberately not the order id alone: a single order can have more than one
 * fulfillment (partial shipments) or more than one refund, and each of those must be able to produce its
 * own document.
 *
 * `xml`/`pdf` are stored inline as Postgres text columns, not in the File Module — T-074 is the task that
 * actually designs and wires file storage (admin "Download e-invoice" widget, Store API endpoint); a text
 * column here answers this task's own two questions ("has this already been generated" and "hand back the
 * bytes when it has") honestly, without guessing at a storage design that belongs to a later task. `pdf`
 * (T-072) is base64-encoded PDF/A-3 bytes, populated only in Webbers integration mode when their own PDF
 * was available to embed this document's XML into (`integrations/webbers.ts`) — `null` for a pure-XML
 * document, which is every document in standalone mode (plan-v0.1 §4.6: "Standalone: только XML").
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
    pdf: model.text().nullable(),
  })
  .indexes([{ on: ["type", "idempotency_key"], unique: true }]);

export default EinvoiceDocument;
