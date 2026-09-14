# commerce-intra-eu

`CommerceInvoiceInput` exercising `docs/tax-semantics.md` row 3 (intra-EU supply, category K) — the D-19
VAT-ID-verification gate (`decideVatCategory` refuses K without a positive VIES check or an explicit
override). `vat-id-evidence.json` is the pre-computed `VatIdEvidence` a caller would have obtained from a
real `VatIdVerifier.verify()` call _before_ calling `buildInvoice` (ADR-003/ADR-001: `buildInvoice` itself
does no I/O) — `tools/conformance/build-commerce-fixtures.mjs` reads it and passes it through
`options.vatIdEvidence`.
