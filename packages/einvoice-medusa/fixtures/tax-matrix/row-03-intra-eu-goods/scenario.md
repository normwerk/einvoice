# row-03-intra-eu-goods

`docs/tax-semantics.md` row 3 — DE→FR B2B, buyer VAT-ID given (goods). Category **K**, 0%
(`VATEX-EU-IC`, `§4 Nr. 1b, §6a UStG`). Buyer VAT-ID is present (`customer.metadata.vat_id`, this plugin's
own convention), `vat-id-evidence.json` scripts a positive VIES check for it, and `billing_address` (no
separate `shipping_address` on this order) supplies `delivery.deliverToCountryCode`/`actualDeliveryDate`
(the latter defaults to the invoice's own `issueDate`, `order-to-commerce-invoice-input.ts`'s own doc
comment on why) — **T-079 closed all three of this cell's build-axis blockers** (P-12, P-25, P-19); the
build axis now reaches category K for real, through the real, unmocked adapter.

- **Build axis**: expected **ok**, category **K**. (Was `error`/`TaxRuleError` before T-079 — see
  `row-03-intra-eu-goods-no-vat-id-evidence/scenario.md` for the mandatory-rejection cell T-079 split out of
  this one once K became reachable at all.)
- **Profile axis**: buyer country FR — expected **ok, `EN16931`**. Was `error`, `UnsupportedCountryError`
  (**P-13**) until **T-066** closed it, untouched by T-079. In the real subscriber pipeline `selectProfile`
  fires _before_ `buildInvoice`, so before T-066 this masked the (already-working) build axis in production
  — France is an EU member state, so `selectProfile` now resolves the EN 16931 hybrid profile for it.

**What T-079 actually closed, in the order the masking chain named them** (see this file's own history for
the original three-bugs-deep analysis): **P-12** (`EinvoiceModuleOptions.vatIdVerifier` + both subscribers
calling `.verify()` before `buildInvoice`, ADR-003) → **P-25** (`mapOrderToCommerceInvoiceInput` now maps
`delivery`, BG-13) → **P-19** (`build-invoice.ts` now guards `BR-IC-02`, buyer VAT-ID on the document itself,
next to the pre-existing `BR-IC-11`/`BR-IC-12` guard). This cell going green on re-run — not a new one — was
T-079's own stated acceptance criterion.

No known bugs remain on this cell as of T-066 (P-12/P-13/P-19/P-25 all closed).
