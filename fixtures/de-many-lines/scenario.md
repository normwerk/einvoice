# de-many-lines

DE → DE B2B, 25 invoice lines (plan-v0.1 §7's "maximum cardinality, many lines" scenario) — a cardinality
stress test, not a new business rule.

- **What this exercises:** the `repeat` plan node over `lines` at realistic (if not extreme) scale, and
  that `BR-CO-*` totals aggregation is correct when summing across many lines rather than one or two.
- **Levels:** L1+L2 verified against the real KoSIT validator (`pnpm conformance:fixtures`).
