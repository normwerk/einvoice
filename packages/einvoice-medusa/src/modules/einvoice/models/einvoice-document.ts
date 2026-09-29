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
 * T-074: `xml_file_id`/`pdf_file_id` replace T-071/T-072's inline text columns (`xml: string`, `pdf: base64
 * string | null`) — those were an explicitly flagged stopgap ("T-074 is the task that actually designs and
 * wires file storage"), not a permanent design. Content now lives in the File Module (`storage.ts`,
 * `access: "private"`); this table only keeps the ids needed to find it again. `pdf_file_id` is `null` for
 * a pure-XML document — every document in standalone mode with no `basePdf` hook (plan-v0.1 §4.6:
 * "Standalone: только XML").
 *
 * P-63: `notice` — set when the invoice was issued although it states less VAT than Medusa charged
 * (`InvoiceNotice`, `mapping/charged-reconciliation.ts`): the codes and amounts the admin widget shows, and
 * the overpayment a refund returns before it credits anything (`credit-note-on-payment-refunded.ts`).
 * `null` for every other document.
 *
 * P-65: `covered_returns` — on a partial credit note, the received returns of goods it paid for, per rate
 * (`[{ returnId, rate, gross }]`), so a later refund does not cover the same return again
 * (`allocateCreditAcrossRates`, `@normwerk/einvoice-commerce`). `null` otherwise. `line_values` — on an
 * invoice, what each order line was invoiced at (`[{ itemId, rate, quantity, gross }]`): a returned unit is
 * credited at that value.
 *
 * P-67: an invoice is for one fulfillment (`idempotency_key`) and carries the lines it shipped;
 * `includes_shipping` marks the one that carries the order's shipping, and `line_values` also hold each
 * line's share of its discount (`allowance`), so the order's next invoice takes what is left of it.
 * `corrected_document_id` — on a credit note, the invoice it corrects, now that an order can have several.
 *
 * T-192: `vat_id_evidence` — on a document of category K, the VIES answer the exemption rests on
 * (`{ vatId, status, checkedAt, consultationNumber? }`, what the merchant's `vatIdVerifier` returned), `null`
 * otherwise; `tax_decisions` — the rule each document followed (`[{ ruleId, categoryCode, reasoning, … }]`,
 * `TaxDecision` of `@normwerk/einvoice-commerce`). See `mapping/tax-evidence.ts`.
 *
 * T-201: `price_notices` — on an invoice, the prices an order edit changed after it was issued
 * (`[{ code, itemId, invoicedUnitPrice, newUnitPrice, direction }]`, `mapping/price-change.ts`), worked out
 * anew each time an edit is confirmed; `null` until one is. `line_values` also hold each line's unit price as
 * Medusa had it (`unitPrice`), which they are compared with.
 *
 * T-033: `pdf_notice` — on a document issued as XML alone because the PDF from `standalone.basePdf` could
 * not become PDF/A (`{ code, fontName? }`, `pdf.ts`); `null` otherwise.
 *
 * No migration path preserves the old `xml`/`pdf` columns' existing content — the same "pre-release, no
 * real deployment history to preserve" reasoning T-072 already used for its own migration replacement
 * (`docs/domain-glossary.md`), not a new precedent.
 */
import { model } from "@medusajs/framework/utils";

const EinvoiceDocument = model
  .define("EinvoiceDocument", {
    id: model.id({ prefix: "einvdoc" }).primaryKey(),
    type: model.enum(["invoice", "credit_note"]),
    order_id: model.text(),
    idempotency_key: model.text(),
    document_number: model.text(),
    xml_file_id: model.text(),
    pdf_file_id: model.text().nullable(),
    notice: model.json().nullable(),
    covered_returns: model.json().nullable(),
    line_values: model.json().nullable(),
    includes_shipping: model.boolean().default(false),
    corrected_document_id: model.text().nullable(),
    vat_id_evidence: model.json().nullable(),
    tax_decisions: model.json().nullable(),
    price_notices: model.json().nullable(),
    pdf_notice: model.json().nullable(),
  })
  .indexes([{ on: ["type", "idempotency_key"], unique: true }]);

export default EinvoiceDocument;
