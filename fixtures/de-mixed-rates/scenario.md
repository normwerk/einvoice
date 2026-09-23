# de-mixed-rates

DE → DE B2B, one invoice mixing the standard rate (19%, furniture) and the reduced rate (7%, books —
UStG §12 Abs. 2 Nr. 1 + Anlage 2). Part of the extended set in [`fixtures/README.md`](../README.md).

- **Categories:** S at 19% and S at 7% — EN 16931 has no separate category for a reduced rate, only a
  second `BG-23` VAT breakdown entry with a different `BT-119` rate under the same `S` category (see
  `docs/tax-semantics.md` row 2 and its "reduced rate is just a lower percentage" pitfall).
- **What this exercises:** two `BG-23` VAT breakdown groups in one document, and `BR-CO-*` totals
  aggregation across categories (`BT-109`/`BT-110`/`BT-112` must sum both breakdown lines correctly).
- **Levels:** L1+L2 verified against the real KoSIT validator (`pnpm conformance:fixtures`).
