# commerce-domestic-mixed-rates

`CommerceInvoiceInput` (not `Invoice`) exercising `docs/tax-semantics.md` row 1/2/9 together: a
domestic DE→DE B2B invoice with one standard-rate line, one reduced-rate line, a document-level shipping
charge, and a document-level discount — the same scenario as `build-invoice.test.ts`'s "mixed rates" test,
here run through the real KoSIT validator (`tools/conformance/build-commerce-fixtures.mjs`,
`pnpm conformance:commerce`) rather than only unit-tested.

Expected: two `BG-23` VAT breakdown groups (19% and 7%). Shipping and the discount are split across the two
rates in proportion to the lines' net amounts (100.00 : 40.00): two `BG-21` charges, 7.14 at 19% and 2.86 at
7%, and two `BG-20` allowances, 3.57 and 1.43, each with its rate in the reason ("anteilig 19 %") — the
groups come to 103.57 at 19% and 41.43 at 7% (`BR-S-08` counts each charge and allowance in its own rate's
taxable amount).
