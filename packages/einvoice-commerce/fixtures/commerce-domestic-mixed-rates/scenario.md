# commerce-domestic-mixed-rates

`CommerceInvoiceInput` (not `Invoice`) exercising `docs/tax-semantics.md` row 1/2/9 together: a
domestic DE→DE B2B invoice with one standard-rate line, one reduced-rate line, a document-level shipping
charge, and a document-level discount — the same scenario as `build-invoice.test.ts`'s "mixed rates" test,
here run through the real KoSIT validator (`tools/conformance/build-commerce-fixtures.mjs`,
`pnpm conformance:commerce`) rather than only unit-tested.

Expected: two `BG-23` VAT breakdown groups (19% and 7%); shipping/discount attributed to the 19% group
(`buildInvoice`'s documented default — see its own doc comment on `chargeCategoryRate`).
