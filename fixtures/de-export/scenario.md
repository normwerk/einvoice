# de-export

DE seller → CH buyer (non-EU), goods exported outside the EU. Corresponds to row 4 of
[`docs/tax-semantics.md`](../../docs/tax-semantics.md).

- **Category:** G (Export outside the EU), 0%
- **Applicable BR-\*:** BR-G-01, BR-G-08, BR-G-09, BR-G-10 (exemption reason mandatory — `VATEX-EU-G`)
- **Norm source:** UStG §4 Nr. 1a + §6 (export supply)
- **Levels:** L1–L5 once `einvoice-cii` (T-020) and the conformance suite (T-040) exist. Currently: valid
  against `einvoice-model`'s generated JSON Schema only (`validateModel()`).

`expected/` is empty until T-020 produces a golden CII XML for this input.
