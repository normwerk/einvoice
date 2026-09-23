# row-03-intra-eu-goods

`docs/tax-semantics.md` row 3 — DE→FR B2B, buyer VAT-ID given (goods). Category **K**, 0%
(`VATEX-EU-IC`, `§4 Nr. 1b, §6a UStG`). Buyer VAT-ID is present (`customer.metadata.vat_id`, this plugin's
own convention), `vat-id-evidence.json` scripts a positive VIES check for it, and `billing_address` (no
separate `shipping_address` on this order) supplies `delivery.deliverToCountryCode`/`actualDeliveryDate`
(the latter defaults to the invoice's own `issueDate`, `order-to-commerce-invoice-input.ts`'s own doc
comment on why). The build axis reaches category K through the real, unmocked adapter.

**What the order has to pass to reach K**, in the order the pipeline checks it — each stage must pass
before the next one can be reached, which is why this cell tests the whole path rather than one guard:

1. **VIES evidence** — `EinvoiceModuleOptions.vatIdVerifier`, whose `.verify()` the invoice subscriber and
   the credit-note path call before `buildInvoice` (ADR-003: verification is I/O, so it happens outside
   `einvoice-commerce`). The harness stands in for it with `vat-id-evidence.json`.
2. **Delivery information** (BG-13) — `mapOrderToCommerceInvoiceInput` maps `delivery` from
   `shipping_address`, falling back to `billing_address`; `buildInvoice` refuses K without it
   (`MissingDeliveryInfoForIntraCommunitySupplyError`, `BR-IC-11`/`BR-IC-12`).
3. **Buyer VAT-ID on the document** — `buildInvoice` guards `BR-IC-02` (`MissingBuyerVatIdError`), next to
   the `BR-IC-11`/`BR-IC-12` guard: a positive VIES check alone is not enough.

After these, `buildInvoice` also checks that the goods are delivered to another member state (FR here) and
that the document's buyer VAT-ID is the one the VIES check was for.

`row-03-intra-eu-goods-no-vat-id-evidence` is the same order without the VIES evidence — the
mandatory-rejection half of this row.

- **Build axis**: expected **ok**, category **K**.
- **Profile axis**: buyer country FR — expected **ok, `EN16931`**. In the real subscriber pipeline
  `selectProfile` fires _before_ `buildInvoice`, so a profile-axis refusal here would hide the build axis in
  production; France is an EU member state, so `selectProfile` resolves the EN 16931 hybrid profile for it.

No known bug involved.
