# row-12-eu-b2b-service

`docs/tax-semantics.md` row 12 — DE→FR B2B, service. Spec says category **AE** — but flags that no official
artifact example exists for this case, so **the code must refuse pending M-006 (human/expert review), not
guess AE by analogy with row 3**. Recorded as `specCategory: "AE"` (T-133, P-28 gap 2) even though the build
axis is a refusal: the research verdict is unambiguous, only its _use_ is blocked pending artifact review.

**This cell proved P-16 live in two steps, on purpose (todo.md's own T-069 instruction), so the fix could be
isolated from T-079's separate evidence fix:**

1. **De-confounding step, before any T-069 code change:** this cell had no `vat-id-evidence.json` and failed
   with "needs a positive VIES check" — the same _text_ T-079 fixed on `row-03`, but here for a stale reason
   (P-12 was already fixed; this cell just hadn't been given evidence). Adding `vat-id-evidence.json` made
   the build axis go **`ok`, category `K`** — live, empirical proof that `supplyType` was being ignored
   (P-16): a service order reached the goods-only intra-EU branch. `knownBugs` at that point: `["P-16"]`.
2. **After T-069 wired `supplyType`** (derived from `items[].requires_shipping`, this order's line now has
   `requires_shipping: false`): the K branch is now excluded for services, and a new row-12-specific branch
   intercepts the case _before_ reaching K — refusing with a message naming `docs/tax-semantics.md` row 12's
   own "no artifact, pending M-006" rule, the same decision the code already had to make deliberately (see
   `todo.md`'s T-069 entry — auto-resolving to AE here was considered and rejected: the row's own written
   instruction is "refuse", matching row 13's treatment, not a guess).

The `vat-id-evidence.json` fixture file is deliberately kept even though it's no longer what decides this
cell's outcome — it proves the refusal is because of M-006, not because of missing VIES evidence (the
refusal fires _before_ `vatIdEvidence` is even consulted).

- **Build axis**: expected **error**, `TaxRuleError` ("no official artifact example confirms a real
  validator accepts it").
- **Profile axis**: buyer country FR — expected **ok, `EN16931`**. Was `error`, `UnsupportedCountryError`
  (**P-13**, masking the correctly-refusing build axis in the real production call order) until **T-066**
  closed it; France is an EU member state.

No known bugs remain on the profile axis as of T-066; the build axis's refusal is spec-correct pending
M-006, not a bug.
