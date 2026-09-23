# commerce-credit-note

`CommerceInvoiceInput` exercising `docs/tax-semantics.md` row 10 (credit note for a return) and the
corrected-invoice requirement: `document.kind === "credit-note"` with a mandatory
`document.correctedInvoice` (BT-25/26) — `buildInvoice` refuses to build a credit note without one
(`MissingCorrectedInvoiceReferenceError`), unlike the base EN 16931 Schematron's `BR-55`, which only
fires if a preceding-invoice-reference group exists at all.
