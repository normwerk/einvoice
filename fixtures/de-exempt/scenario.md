# de-exempt

DE domestic exempt supply (medical treatment, §4 Nr. 14 UStG). Corresponds to row 6 of
[`docs/tax-semantics.md`](../../docs/tax-semantics.md).

- **Category:** E (Exempt from VAT), 0%
- **Applicable BR-\*:** BR-E-01, BR-E-08, BR-E-09, BR-E-10 (needs `exemptionReasonText` or
  `exemptionReasonCode` — this fixture uses free text only)
- **Norm source:** UStG §4 (exemption number varies by case)
- **Why no `exemptionReasonCode`:** unlike K/AE/G, category E has no single universal `VATEX-*` code —
  which specific UStG §4 exemption applies is a case-by-case legal judgment (see
  `docs/tax-semantics.md`'s "what the validator does not catch" section, and M-006).
- **Levels:** L1–L5 once `einvoice-cii` (T-020) and the conformance suite (T-040) exist. Currently: valid
  against `einvoice-model`'s generated JSON Schema only (`validateModel()`).

`expected/` is empty until T-020 produces a golden CII XML for this input.
