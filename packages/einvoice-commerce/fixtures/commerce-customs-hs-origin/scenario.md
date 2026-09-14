# commerce-customs-hs-origin

`CommerceInvoiceInput` for a domestic DE→DE invoice (`docs/tax-semantics.md` row 1) where one line
carries `hsCode`/`originCountry` (BT-158/BT-159 — an item classification identifier and its country of
origin) and the other line carries neither. Exercises T-060's continuation (D-19): `buildInvoice` maps
both fields into the assembled `Invoice`'s `InvoiceLine`, and `einvoice-cii`'s serialization plan emits
`ram:SpecifiedTradeProduct/ram:DesignatedProductClassification/ram:ClassCode[@listID='HS']` and
`ram:SpecifiedTradeProduct/ram:OriginTradeCountry/ram:ID` only for the line that has them — the plain
line renders neither element, proving the mapping is per-line and conditional, not always-on.

`hsCode: "847130"` is HS heading 8471.30 (portable automatic data-processing machines) — real WCO
Harmonized System content used as realistic fixture data, not a domain claim this codebase asserts (the
scheme identifier `"HS"` itself, `@listID`, is the codebase's own claim — verified against
`BR-CL-13`'s vendored UNTDID 7143 codelist and cross-checked against docs.peppol.eu's own recommendation
for this exact purpose; see `tools/codegen/model/terms.mjs` and `packages/einvoice-cii/src/generated/plan.ts`).
