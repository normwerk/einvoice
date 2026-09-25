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

## Admin: "E-Invoices" widget on the order page

`src/admin/widgets/order-einvoice.tsx` — a widget in the `order.details.side.after` zone (the same side
column `@webbers/invoices-medusa`'s own real invoice widget uses one zone over, `order.details.side.before`,
confirmed by reading their published admin bundle directly). Lists every e-invoice document for the
order with a download icon for XML and, when one exists, PDF.

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
way (`src/refusals.ts`), for invoices and credit notes alike: the code is the error's class name, the details
its message (and, for a credit note, the event its retry redelivers). The subscriber completes instead of
throwing. A cancelled order's invoice refusals are dropped.

`GET /admin/orders/:id/einvoice` returns both: `documents` (each with its `notice`, or `null`) and
`refusals` (each with its explanation and a `retryUrl`). `POST /admin/orders/:id/einvoice/refusals/:refusalId/retry`
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

## What this deliberately does not do

- No `defineLink` between `order` and `EinvoiceDocument` — `EinvoiceDocument.order_id` (a plain field)
  already answers every query this plugin itself needs; adding a module link on top would create a
  second, parallel way to express the same relationship for no real gain, and risks the two disagreeing.
  `@webbers/invoices-medusa`'s own `invoice_order` link is a different case: their `Invoice` model
  has no order-identifying field at all, so a link is the _only_ mechanism available to them.
- No migration path preserves the old `xml`/`pdf` columns' content — the same "pre-release, no real
  deployment history to preserve" reasoning an earlier migration replacement already used (see
  `docs/domain-glossary.md`).
