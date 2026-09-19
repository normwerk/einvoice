# row-12-eu-b2b-service-override

`docs/tax-semantics.md` row 12 — DE→FR B2B, service — same scenario as `row-12-eu-b2b-service`, except this
order carries `order.metadata.regime_override: { kind: "reverse-charge-cross-border" }` (T-135/P-34).

`row-12-eu-b2b-service` proved the _default_ behaviour is a correct refusal pending M-006. That refusal used
to be a dead end: before T-135, no `RegimeOverride` reached AE for a cross-border service at all — row 5's
`reverse-charge` override explicitly rejects any non-DE buyer (`docs/tax-semantics.md` row 5 is DE→DE only).
This cell proves the escape hatch the pattern already has for K (row 3's `intra-eu-confirmed` override) now
also exists for row 12: a merchant who has decided the fact for themselves is not blocked by the code's own
refusal to guess.

- **Build axis**: expected **ok, AE** — `decideVatCategory`'s new `reverse-charge-cross-border` branch
  (`tax-rules.ts`), checked ahead of the default row-12 refusal, returns `VATEX-EU-AE` with `ruleId
"tax-semantics#12"`. The buyer carries a VAT-ID (`customer.metadata.vat_id`), satisfying `BR-AE-02`
  (`MissingBuyerIdentifierForReverseChargeError` would otherwise fire the same way it did on `row-05` before
  its own fixture got one, T-069's follow-up).
- **Profile axis**: buyer country FR ≠ DE — expected **error**, `UnsupportedCountryError`, same known bug
  **P-13** every other cross-border cell in this matrix already carries (owned by T-066, not this task).

Known bugs: **P-13** (profile axis only — the build axis is spec-correct AE, not a bug).
