# row-08-zero-rated-photovoltaic

`docs/tax-semantics.md` row 8 — DE domestic B2B, photovoltaic installation (§12 Abs. 3 UStG, in force since
2023-01-01) — the only real German zero rate. Category should be **Z**, 0%. Added by T-133 (P-28 gap 3):
the original T-117 matrix explained why rows 10/11 are absent but said nothing about row 8, an unexplained
silence this cell closes.

Same root cause as row 5 (AE) and row 6 (E): `decideVatCategory`'s zero-rated branch only activates on an
explicit `regimeOverride: { kind: "zero-rated" }`, and `MapOrderOptions` has no field to supply one (P-14) —
so, exactly like AE and E, category Z is unreachable through the real adapter today, not because the tax
logic itself is missing (`tax-rules.ts` has a full Z branch, kept "for code-coverage completeness") but
because nothing upstream can ever ask for it. With a DE buyer and no override, the request silently falls
through to domestic **S** — no exception, no visible sign anything is wrong. The order's own zero-rated tax
line (`rate: 0`) then makes `inferTaxRateKind` guess "reduced" (0 is numerically closer to 7 than to 19), the
same compounding-but-not-separate quirk row 6's `scenario.md` already documents for a 0% line.

**Why this cell earns its place beyond "one more P-14 instance".** `BR-Z-10` is the only rule in this table
that runs in the opposite direction from E/AE/G/K: it **forbids** a BT-120/121 exemption reason on a Z line,
where every other non-standard category **requires** one. Every other cell in this matrix that exercises a
non-S category is therefore structurally unable to catch a regression that adds an exemption reason "just in
case" — this is the one cell that could, once Z is actually reachable. It can't demonstrate that live today
(the category is never reached), but its absence would have meant the matrix has no test asserting the
existence of that rule's opposite-direction shape at all.

- **Build axis**: expected **"ok", category S** (spec says Z) — known bug **P-14** (`regimeOverride` never
  threaded through, `packages/einvoice-medusa/src/mapping/order-to-commerce-invoice-input.ts`), same as
  rows 5/6.
- **Profile axis**: DE buyer, no B2G reference — expected **green**, `EN16931`.

Known bug: **P-14** (build axis only).
