# row-03-intra-eu-goods-no-vat-id-evidence

`docs/tax-semantics.md` row 3 — same order as `row-03-intra-eu-goods` (DE→FR B2B, buyer VAT-ID given, goods),
but with no `vat-id-evidence.json`: the mandatory-rejection twin of that cell.

`row-03-intra-eu-goods` reaches category K through the real adapter: the configured `VatIdVerifier`
(`EinvoiceModuleOptions.vatIdVerifier`, called by the invoice subscriber and the credit-note path before
`buildInvoice`) supplies the VIES result, the mapper supplies `delivery`, and the buyer VAT-ID is on the
document. With K reachable, this cell proves the other half of the rule: the same order without a positive
VIES check is still refused.

- **Build axis**: expected **error**, `TaxRuleError` ("needs a positive VIES check") — `decideVatCategory`'s
  own refusal (`einvoice-commerce`): no `vatIdEvidence` and no `regimeOverride: { kind: "intra-eu-confirmed" }`
  means no category K, by design — K is never selected on an unverified VAT-ID.
- **Profile axis**: buyer country FR — expected **ok, `EN16931`**, same as `row-03-intra-eu-goods`.

No known bug: the build axis's refusal is the documented behaviour, not a bug.
