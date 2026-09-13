# de-b2b-standard

DE seller → DE B2B buyer, domestic supply, standard VAT rate. The baseline scenario — every other fixture
is a variation on this one. Corresponds to row 1 of [`docs/tax-semantics.md`](../../docs/tax-semantics.md).

- **Category:** S (Standard rated), 19%
- **Applicable BR-\*:** BR-S-01, BR-S-02, BR-S-08, BR-S-09
- **Norm source:** UStG §12 Abs. 1
- **Levels:** L1–L5 once `einvoice-cii` (T-020) and the conformance suite (T-040) exist. Currently: valid
  against `einvoice-model`'s generated JSON Schema only (`validateModel()`).

`expected/` is empty until T-020 produces a golden CII XML for this input.
