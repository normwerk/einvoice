# row-06-exempt

`docs/tax-semantics.md` row 6 — DE domestic, exempt supply (§4 UStG — medical treatment, §4 Nr. 14, used
here as a concrete, unambiguous example; the spec table itself flags row 6 as needing expert confirmation
for the general case since there's no universal `VATEX` code for "exempt", only a case-by-case UStG
paragraph). Category should be **E**, 0%.

Same root cause as row 5: `decideVatCategory`'s exempt branch only activates on an explicit
`regimeOverride: { kind: "exempt" }`, which `MapOrderOptions` has no field for. With a DE buyer, no override
silently falls through to domestic **S** — no exception. The order's own captured tax line (`rate: 0`,
plausible for a store that correctly zero-rated this line itself) then makes `inferTaxRateKind` guess
"reduced" (0 is numerically closer to 7 than to 19) — a second, compounding wrongness that is a direct
artifact of the same P-14 gap, not a separate finding: once `regimeOverride` reaches the branch that needs
it, per-line rate inference is never consulted for E in the first place (`resolveLineRate` fixes non-S
categories to "0").

- **Build axis**: expected **"ok", category S** (spec says E) — known bug **P-14**.
- **Profile axis**: DE buyer, no B2G reference — expected **green**, `EN16931`.

Known bug: **P-14** (build axis only).
