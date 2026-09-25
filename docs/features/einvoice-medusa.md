# `einvoice-medusa` — File Module storage, admin widget, Store API

Back to [`docs/README.md`](../README.md). Covers private storage in the File Module, the admin widget, and
the Store API endpoint — what happens to a document _after_ it's generated. Generating it (the subscribers,
idempotency, numbering and the PDF) is not covered on this page.

## Storage: real File Module files, not inline columns

Originally, `EinvoiceDocument` stored the XML as a Postgres `text` column and the PDF as a base64-encoded
`text` column — both doc comments flagged this as a deliberate, temporary stopgap. Both are now replaced
with real files: `storage.ts`'s `storeEinvoiceFiles` uploads the XML (always) and the PDF
(when one was produced) through `Modules.FILE`'s own `createFiles`, `access: "private"` — an e-invoice
carries the same buyer name/address/VAT-ID class of data a merchant would not want publicly listable.
`EinvoiceDocument` now stores `xml_file_id`/`pdf_file_id` (a file id each), not the content.

Both subscribers upload before the idempotency-guarding insert (there's no other order — the insert needs
the ids already). This means the pre-existing "two literally concurrent deliveries of the same event"
edge case (`recordDocumentIfAbsent`'s own doc comment) now also orphans a just-uploaded file for
whichever delivery loses the database `UNIQUE` insert — `deleteEinvoiceFiles` cleans those up, best-effort,
when `recordDocumentIfAbsent` reports `created: false`.

## What the plugin stores

Everything stays in the shop's own database and File Module; nothing is sent anywhere else by the plugin.

| Where                               | What                                                                                                                                                                     | Personal data                                                  |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| File Module, private                | The XML and, if one was produced, the PDF of every document                                                                                                              | The buyer's name, address, VAT-ID and email, as on any invoice |
| `einvoice_document`                 | Per document: its type, order, number, file ids, the notice of a difference with what Medusa charged, what each line was invoiced at, the invoice a credit note corrects | None                                                           |
| `einvoice_document.tax_decisions`   | The rule of [`docs/tax-semantics.md`](../tax-semantics.md) the document followed, its VAT category and the reasoning                                                     | The reasoning of an intra-EU supply names the buyer's VAT-ID   |
| `einvoice_document.vat_id_evidence` | Only on a document of category K: the answer of your `vatIdVerifier` the exemption rests on — VAT-ID, status, date, VIES's consultation number                           | The buyer's VAT-ID, already on the invoice itself              |
| `einvoice_refusal`                  | A document that was not issued: its code and the amounts or the message explaining it                                                                                    | The message may name the buyer's VAT-ID or country             |
| `einvoice_counter`                  | The last number of each series                                                                                                                                           | None                                                           |

An intra-EU supply is exempt only if the buyer's VAT-ID was valid on the day of supply (§6a Abs. 1 Nr. 4
UStG), which the seller must be able to show; that is why the VIES answer is kept with the document that
rests on it, and on no other. The plugin deletes none of these records; keep them as long as the tax
records they belong to. It logs no invoice content and no buyer details, and its events carry ids, the
number and codes only.
If you record your processing of personal data, the table above is what the plugin adds to it; the VIES check
itself is a request your own `vatIdVerifier` makes.

## Admin: "E-Invoices" widget on the order page

`src/admin/widgets/order-einvoice.tsx` — a widget in the `order.details.side.after` zone (the same side
column `@webbers/invoices-medusa`'s own real invoice widget uses one zone over, `order.details.side.before`,
confirmed by reading their published admin bundle directly). Lists every e-invoice document for the
order with a download icon for XML and, when one exists, PDF. Under each document: its VAT category and the
rule it followed (the reasoning on hover), and on a document of category K the VIES answer its exemption
rests on — VAT-ID, status, date and consultation number.

Verified live against a real running dashboard (`create-medusa-app@2.19.0`, this task's own e2e harness):
logged in as a real admin user, opened order `#1`, scrolled to the side column, and found:

```
E-Invoices
Credit note GS-2026-0001                              ⬇ ⬇
Invoice RE-2026-0001                                   ⬇ ⬇
```

Clicking a download icon issued a real `GET /admin/orders/:id/einvoice/:documentId/xml` request that
returned **200 OK** with the correct file (confirmed via the browser's own network log — the browser's
download-sandbox reports the navigation itself as aborted, which is expected for a `Content-Disposition:
attachment` response opened via `target="_blank"`, not a failure of the route).

A screenshot of this was reviewed live during verification but isn't included as a file in this repo — the
session this was built in has no way to save the preview browser's frame to disk (no accessible display for
a native screenshot, and the preview tool itself has no "save to path" capture). The `E-Invoices` heading,
row labels, and request path above are transcribed verbatim from that live session, not reconstructed from
the code alone.

## One invoice per fulfillment

Each fulfillment is invoiced on its own (`src/invoices/issue-invoice.ts`, `src/mapping/shipment.ts`): the
lines and units it shipped, dated the day it shipped, the order's shipping on the first invoice still
standing, and each line's discount shared out by units. Beside the XML, an invoice's row keeps what each
line was invoiced at and its discount share (`line_values`) and whether it carries the shipping
(`includes_shipping`) — what the order's next invoice reads to take the rest. A credit note's row names the
invoice it corrects (`corrected_document_id`). Cancelling a fulfillment credits its invoice
(`src/subscribers/credit-note-on-fulfillment-canceled.ts`); a refund credits the one invoice it can be tied
to (`chooseRefundInvoice`, `src/mapping/credit-note.ts`) or is recorded as refused.

## Notices, and invoices not issued

Before an invoice takes a number, it is compared with what Medusa charged (`reconcileWithCharged`,
`src/mapping/charged-reconciliation.ts`; the rule is in [`docs/tax-semantics.md`](../tax-semantics.md) and
[`docs/quickstart-medusa.md`](../quickstart-medusa.md#when-the-invoice-and-medusa-disagree)). Two outcomes are
stored:

- an invoice issued although it states less VAT than Medusa charged keeps the comparison on its own row,
  `EinvoiceDocument.notice` (JSON: code, amounts, what to refund) — the refund subscriber reads it to return
  an overpayment before it credits anything;
- an invoice not issued is an `EinvoiceRefusal` row (`src/modules/einvoice/models/einvoice-refusal.ts`):
  `(type, idempotency_key)` unique like a document's, with the code and the amounts. A retry refused again
  updates it; the issued document deletes it.

Every other refusal before a document number is taken — `buildInvoice`'s, the mapping's, a VAT-ID check that
failed, a refund with no invoice to correct — is recorded the same
way (`src/refusals.ts`), for invoices and credit notes alike: the code is the error's own `code` — every error
the packages raise carries one, with a `docsUrl` to its explanation (`EinvoiceError` in
`@normwerk/einvoice-model`, `PluginError` in `src/errors.ts`) — or `INTERNAL_ERROR` for anything else; the
details hold its message and class (and, for a credit note, the event its retry redelivers; for an
unsupported buyer country, the country). The subscriber completes instead of
throwing. A cancelled order's invoice refusals are dropped.

`GET /admin/orders/:id/einvoice` returns both: `documents` (each with its `notice`, or `null`) and
`refusals` (each with its explanation, a `retryUrl`, and for an unsupported buyer country a
`supportRequestUrl` — a new issue in the public repository, filled in with the country only). Every notice
and refusal carries the `docsUrl` of its code, which the widget links. `GET /admin/einvoice/support` states
what the release supports (`describeSupport`, `@normwerk/einvoice-commerce`) for the "E-Invoicing" block on
the store's settings page (`src/admin/widgets/einvoice-support.tsx`, zone `store.details.after`). `POST /admin/orders/:id/einvoice/refusals/:refusalId/retry`
runs the same `issueInvoiceForFulfillment` (`src/invoices/issue-invoice.ts`) as the fulfillment subscriber,
checks included, and answers `issued` or `blocked` (with the reason). For a credit note it redelivers the
refund's or the cancellation's event to its subscriber and answers `issued`, `blocked`, or `none` (nothing
left to credit). A failure after the checks — storage, the database — answers 500 with its message. The Store API lists documents without notices — they tell the merchant what to refund.

The widget shows a notice as an orange badge under its document ("Refund due" or "VAT differs from Medusa")
with the explanation, and a refused invoice as a red "Invoice not issued" badge with the explanation and a
**Retry** button. The API behind it is covered end to end (`e2e/src/scenarios/s12-*`, `s13-*`, `s14-*`); the widget's
own rendering has not been checked in a browser yet ([`docs/manual-testing.md`](../manual-testing.md#admin-widget-visually)).

## Store: a customer's own e-invoices

`GET /store/orders/:id/einvoice` and `.../:documentId/{xml,pdf}` — requires
`authenticate("customer", ["session", "bearer"])` (`src/api/middlewares.ts`) **and** that the authenticated
customer actually owns the order (`customerOwnsOrder`, `src/api/einvoice-http.ts`).

This is a deliberate departure from Medusa's own precedent: `@medusajs/medusa`'s real, compiled
`GET /store/orders/:id` route carries no ownership check at all — its own source has a
`// TODO: Do we want to apply some sort of authentication here?` comment, confirmed by reading it directly.
An e-invoice is exactly the kind of document that TODO should worry about (the same buyer PII
`storage.ts`'s own `access: "private"` already treats as worth protecting), so this plugin adds the check
itself rather than inheriting Medusa's own open gap.

Verified end to end, real registered customers (not stubs):

| Caller                      | Request                          | Result                                                                                                     |
| --------------------------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| No token at all             | `GET /store/orders/:id/einvoice` | `401 Unauthorized` (the `authenticate` middleware)                                                         |
| A different, real customer  | same                             | `404` ("No order …")                                                                                       |
| The order's actual customer | same                             | `200`, real document list                                                                                  |
| The order's actual customer | `.../:documentId/xml`            | `200`, byte-identical to the file the subscriber uploaded, **real KoSIT Validator: Validation successful** |

A cross-order id/document id pairing (a real document id from order A, requested against order B's own
URL) was also tried against the _admin_ route and correctly returned `404` — `sendEinvoiceFile` filters by
`(id, order_id)` together, not `id` alone, so a document can't be pulled by pairing its real id with a
different, otherwise-authorized order.

## Events and the order link — for a shop's own code

The plugin announces what it did on Medusa's event bus (`src/events.ts`), so a shop can act on it — send the
invoice to the buyer, pass it to accounting, alert someone when one is not issued:

| Event                       | When                                                                                     | Payload                                                                                                                             |
| --------------------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `einvoice.document_issued`  | an invoice or credit note was issued, by its Medusa event or by a retry from the admin   | `{ schema_version: 1, id, order_id, type: "invoice" \| "credit_note", document_number, fulfillment_id?, refund_id?, notice_code? }` |
| `einvoice.issuance_blocked` | a document was not issued — blocked by the check against what Medusa charged, or refused | `{ schema_version: 1, refusal_id, order_id, type, code }`                                                                           |

- Ids, the number and codes only — never the document's content or the buyer's details. `code` is one of
  the [error reference](https://normwerk.dev/einvoice/docs/errors)'s codes.
- At least once, like every Medusa event: make a subscriber idempotent by `id` (`refusal_id`). No event when
  a redelivered Medusa event finds its document already issued. An event goes out right after its document
  or refusal is written; if the process stops in between, the event is lost — the document is not, and it
  shows in the order's "E-Invoices" block.
- A new field can appear without a new `schema_version`. A change that would break a subscriber comes under
  a new event name (`einvoice.document_issued.v2`), sent alongside the old one until the next major version
  of the package.
- The types — `DocumentIssuedEvent`, `IssuanceBlockedEvent`, `EinvoiceDocumentDTO`, `EINVOICE_EVENTS` — are
  published with the package: `import type { DocumentIssuedEvent } from "@normwerk/einvoice-medusa/events"`.

An order's documents are read with the order through a read-only link on the document's own `order_id`
(`src/links/order-einvoice-documents.ts` — no link table, no migration):

```ts
const { data } = await query.graph({
  entity: "order",
  filters: { id: orderId },
  fields: ["id", "einvoice_documents.*"],
});
```

A document's public fields are `EinvoiceDocumentDTO`: `id`, `type`, `order_id`, `document_number`,
`xml_file_id`, `pdf_file_id` (File Module ids — read the files through the File Module), `notice`,
`tax_decisions` and `vat_id_evidence` (see [What the plugin stores](#what-the-plugin-stores)). Other columns
are the plugin's own and may change.

The end-to-end suite has a subscriber of its own receive the events (S19).

## What this deliberately does not do

- No outbox: an event lost between writing the document and sending the event is not sent later.
- No migration path preserves the old `xml`/`pdf` columns' content — the same "pre-release, no real
  deployment history to preserve" reasoning an earlier migration replacement already used (see
  `docs/domain-glossary.md`).
