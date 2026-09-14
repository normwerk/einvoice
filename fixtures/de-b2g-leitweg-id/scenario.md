# de-b2g-leitweg-id

DE → DE B2G (public-sector buyer), with `buyerReference` (BT-10) set to a real Leitweg-ID-shaped value
(`04011000-1234512345-06`) instead of the generic free-text reference the other fixtures use.

- **What this exercises:** BT-10 is the exact field German public-sector invoicing (XRechnung's origin
  case) uses for Leitweg-ID routing — `AGENTS.md` §2's own example pitfall ("XRechnung requires BT-10
  BuyerReference even when Leitweg-ID is absent — BR-DE-15") is about this field. This fixture is the one
  that actually carries a Leitweg-ID-shaped value, not just an arbitrary reference string; the other 6+6
  fixtures set `buyerReference` to satisfy `BR-DE-15` but never in this specific shape.
- **Levels:** L1+L2 verified against the real KoSIT validator (`pnpm conformance:fixtures`).
