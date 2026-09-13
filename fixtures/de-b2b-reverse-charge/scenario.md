# de-b2b-reverse-charge

DE seller → DE B2B buyer, domestic service subject to the construction-sector reverse charge (§13b UStG).
Corresponds to row 5 of [`docs/tax-semantics.md`](../../docs/tax-semantics.md).

- **Category:** AE (Reverse charge), 0%
- **Applicable BR-\*:** BR-AE-01, BR-AE-02, BR-AE-08, BR-AE-09, BR-AE-10 (exemption reason is **mandatory**
  for AE — `VATEX-EU-AE`)
- **Norm source:** UStG §13b
- **What the validator does not catch:** whether this specific service actually qualifies for §13b reverse
  charge is a legal judgment `einvoice-commerce` will need to make from `TaxContext`, not something any
  validator checks (see `docs/tax-semantics.md` for related gaps).
- **Levels:** L1–L5 once `einvoice-cii` (T-020) and the conformance suite (T-040) exist. Currently: valid
  against `einvoice-model`'s generated JSON Schema only (`validateModel()`).

`expected/` is empty until T-020 produces a golden CII XML for this input.
