# @normwerk/einvoice-commerce

## 0.1.0

### Minor Changes

- First release. `buildInvoice` turns an order, a refund or a cancellation of a seller in Germany into an
  EN 16931 invoice or credit note: the VAT category of every line, with the rule that decided it; German
  rates by date of supply, including the 16% and 5% of the second half of 2020; destination rates for an
  OSS-registered seller; prices entered including VAT; shipping and discounts at the rate of the goods;
  credit notes at the rates of the invoice they correct; sequential numbering; and the profile — XRechnung
  for a public-sector buyer with a Leitweg-ID, EN 16931 otherwise. What it cannot decide correctly it
  refuses with a stable code. Platform-agnostic: no Medusa or Vendure types.

### Patch Changes

- Updated dependencies
  - @normwerk/einvoice-model@0.1.0
