# row-11-corrected-invoice-384 (documentation only, no runnable fixture)

`docs/tax-semantics.md` row 11 — corrected invoice, document type code 384 (as opposed to a credit note, 381) — `BR-DE-17` names the allowed XRechnung document-type codes, `BR-DE-26` recommends but does not
require `BT-25` (both `flag="warning"`, not fatal — the same non-enforcement pattern as row 10's `BR-55`
gap).

There is no `order.json` in this directory and no way to add one: `CommerceInvoiceInput.document.kind` only
accepts `"invoice" | "credit-note"` (`packages/einvoice-commerce/src/types.ts`) — document type 384 is not a
value the type system, `mapOrderToCommerceInvoiceInput`, or `buildInvoice` can express at all. This is not a
bug to fix inside T-117; it's a real, already-documented v0.1 boundary (`docs/tax-semantics.md` row 11's own
note). `load-cells.ts` skips any directory without an `order.json`, so this cell contributes no test — it
exists purely to keep this row visible in the matrix's own inventory (see the top-level `README.md`).

Bucket: **out of scope for v0.1** (document-type modeling, not the adapter this matrix tests). No known bug.
