# row-12-eu-b2b-service

`docs/tax-semantics.md` row 12 — DE→FR B2B, service. Spec says category **AE** — but flags that no official
artifact example exists for this case, so **the code must refuse pending M-006 (human/expert review), not
guess AE by analogy with row 3**. Unlike row 13, the category itself is not in dispute — the research
verdict is unambiguous (AE), only its _use_ is blocked pending artifact review — so `specCategory: "AE"` is
recorded (T-133, P-28 gap 2): once P-12/P-13/P-16 are fixed and M-006 clears this row, whoever re-runs this
cell knows exactly which category to expect, rather than having to re-derive it from prose. The
correct build-axis outcome for now is still a refusal, not a resolved category — that's what `build` below
asserts against the real, current adapter output.

The real, distinguishing bug here is **P-16**: `TaxContext.supplyType` is set by the mapper (hardcoded
`"goods"`, per its own doc comment — this order is a service, but the adapter has no way to say so) and
never read by `decideVatCategory` at all (confirmed by grep — zero matches outside its own type
declaration). A service line is therefore processed _identically_ to a goods line: this order has an EU
buyer with a VAT-ID, so it lands in exactly the same intra-EU (K) branch as `row-03-intra-eu-goods` and
fails for the same immediate reason (P-12, no VAT-ID evidence path) — but the deeper, service-specific
problem P-16 describes is that the code never even distinguished this from a goods sale in the first place,
so fixing P-12 alone would make this cell wrongly resolve to **K**, not the AE the spec actually expects.

- **Build axis**: expected **error**, `TaxRuleError` ("needs a positive VIES check") — same proximate cause
  as row 3 (**P-12**), but the underlying, distinguishing defect is **P-16** (supplyType ignored).
- **Profile axis**: buyer country FR ≠ DE — expected **error**, `UnsupportedCountryError`. Known bug
  **P-13**, masking everything above in the real production call order.

Known bugs: **P-16** (root cause), **P-12** (proximate cause), **P-13** (profile axis, masks both).
