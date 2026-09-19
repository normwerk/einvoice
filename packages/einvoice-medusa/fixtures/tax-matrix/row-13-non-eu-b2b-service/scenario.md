# row-13-non-eu-b2b-service

`docs/tax-semantics.md` row 13 — DE→US B2B, service. **CONTESTED**: EC guidance is ambiguous and no
artifact shows a service line resolving to G (export) — the addenda cross-reference (`researches/08-vat-
rules-de-addition-1.md` Q4, `-addition-2.md` Q2, correspondence table in queue entry P-23) reconfirms this
with "a significant negative result" across four artifact corpora, not just an oversight. No `specCategory`
— unlike row 12, no single category is even the _known-but-blocked_ right answer here; refusal is the only
spec-correct behaviour, `specRequiresRefusal: true` (T-133, P-28 gap 1/2).

**T-069 closed P-16.** `decideVatCategory` now has a dedicated row-13 branch — `sellerCountry === "DE" &&
!buyerIsEu && buyerIsBusiness && supplyType === "services"` — checked _before_ the export (G) branch, so a
non-EU B2B service order (this cell's line now carries `requires_shipping: false`) no longer silently falls
through to the same category a goods export would get. This was, before the fix, "the sharpest illustration
of P-16 in the whole matrix" (this file's own prior text): a fully assembled, KoSIT-valid document for a
scenario the spec explicitly says must not be resolved automatically. It is now a refusal instead, citing
row 13's own CONTESTED status.

This cell is the live proof T-117 promised for exactly this case: "the day P-16 actually changes this
branch's behaviour, `build`'s `kind: 'ok'`/`category: 'G'` stops matching reality and `tax-matrix.test.ts`
goes red on this cell" — that's what happened, and `expected.json` now records the new, correct outcome.

- **Build axis**: expected **error**, `TaxRuleError` (CONTESTED, citing `docs/tax-semantics.md` row 13).
  This cell drops out of the Docker gate's "validated" set (`expected.build.kind === "ok"` no longer
  applies) — a refusal never reaches serialization, so there is nothing left for KoSIT to check here.
- **Profile axis**: buyer country US — still expected **error**, `UnsupportedCountryError`, unchanged by
  **T-066**. Before T-066 this was **P-13** (every non-DE buyer refused unconditionally) masking the
  correctly-refusing build axis; T-066 replaced that blanket gate with five branches (`profile.ts`'s own
  numbered doc comment), and the US falls into **branch 5** ("anything else — not DE, not EU/EEA, not CH/UK,
  not a clearance country") — v0.1 has no reviewed e-invoicing basis for it at all, the same generic "not yet
  supported" refusal as before, just no longer a bug. Re-run against the real, fixed `selectProfile`:
  byte-for-byte the same outcome.

No known bugs remain on this cell as of T-066 — both axes are spec-correct refusals. **T-136/P-35**: this
cell's `knownBugs: ["P-13"]` label in `expected.json` was itself stale — the prose above already recorded
the fix, but the machine-readable field had never been updated to match. Removed, so `expected.json` and
`scenario.md` no longer disagree.
