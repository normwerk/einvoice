# `einvoice-medusa` — File Module storage, admin widget, Store API (T-074)

Back to [`docs/README.md`](../README.md). Covers the third piece of W10's own acceptance criterion
("хранение в File Module (private); admin-виджет и Store API endpoint") — subscribers/idempotency are
T-071, the two numbering/PDF modes are T-072 (Webbers)/T-073 (standalone); this page is about what happens
to a document _after_ it's generated.

## Storage: real File Module files, not inline columns

Through T-071–T-073, `EinvoiceDocument` stored the XML as a Postgres `text` column and the PDF as a
base64-encoded `text` column — both doc comments flagged this as a deliberate, temporary stopgap. T-074
replaces both with real files: `storage.ts`'s `storeEinvoiceFiles` uploads the XML (always) and the PDF
(when one was produced) through `Modules.FILE`'s own `createFiles`, `access: "private"` — an e-invoice
carries the same buyer name/address/VAT-ID class of data a merchant would not want publicly listable.
`EinvoiceDocument` now stores `xml_file_id`/`pdf_file_id` (a file id each), not the content.

Both subscribers upload before the idempotency-guarding insert (there's no other order — the insert needs
the ids already). This means the pre-existing "two literally concurrent deliveries of the same event"
edge case (`recordDocumentIfAbsent`'s own doc comment, T-071) now also orphans a just-uploaded file for
whichever delivery loses the database `UNIQUE` insert — `deleteEinvoiceFiles` cleans those up, best-effort,
when `recordDocumentIfAbsent` reports `created: false`.

## Admin: "E-Invoices" widget on the order page

`src/admin/widgets/order-einvoice.tsx` — a widget in the `order.details.side.after` zone (the same side
column `@webbers/invoices-medusa`'s own real invoice widget uses one zone over, `order.details.side.before`,
confirmed by reading their published admin bundle directly, T-072). Lists every e-invoice document for the
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

- No `defineLink` between `order` and `EinvoiceDocument` — `EinvoiceDocument.order_id` (a plain field,
  T-071) already answers every query this plugin itself needs; adding a module link on top would create a
  second, parallel way to express the same relationship for no real gain, and risks the two disagreeing.
  `@webbers/invoices-medusa`'s own `invoice_order` link (T-072) is a different case: their `Invoice` model
  has no order-identifying field at all, so a link is the _only_ mechanism available to them.
- No migration path preserves the old `xml`/`pdf` columns' content — same "pre-release, no real deployment
  history to preserve" reasoning T-072 already used for its own migration replacement.
