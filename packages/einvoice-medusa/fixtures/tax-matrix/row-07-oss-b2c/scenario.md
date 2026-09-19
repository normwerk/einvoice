# row-07-oss-b2c

`docs/tax-semantics.md` row 7 — DE→NL, B2C distance sale under the OSS one-stop-shop scheme. Category **S**
at the buyer country's own rate (Art. 33 VAT Directive), supplied by the caller via
`taxContext.ossRateOverride` since this package doesn't maintain an EU rate table.

`decideVatCategory`'s OSS branch additionally requires `taxContext.ossRegistered === true`. **The adapter
hardcodes `ossRegistered: false` for every order** (`order-to-commerce-invoice-input.ts`) — there is no
config or order-level source for it at all, so the branch condition can never be true through the real
adapter. This is a new finding beyond the five named bugs, queued as **P-26**
(`ecom docs/plan-v0.1-pending.md`). It also means this cell doubles as "OSS without `ossRateOverride`" —
even if `ossRegistered` could somehow be set, there's no field for the rate override either, but
`ossRegistered` is the more fundamental of the two gaps.

With `ossRegistered` false and no other branch matching (B2C buyer fails the intra-EU/AE/Z/E branches, which
all need `buyerIsBusiness`; the buyer is inside the EU so the export branch doesn't match either; the buyer
isn't DE so the domestic branch doesn't match), `decideVatCategory` falls all the way through to its own
final refusal.

- **Build axis**: expected **error**, `TaxRuleError` ("No rule in docs/tax-semantics.md matches this
  TaxContext"). New finding **P-26**.
- **Profile axis**: buyer country NL — expected **ok, `EN16931`**. Was `error`, `UnsupportedCountryError`
  (**P-13**, masking P-26 in the real production call order, same relationship as row 3/P-12) until **T-066**
  closed it; the Netherlands is an EU member state.

Known bugs: **P-26** (build axis, new finding) — **P-13** (profile axis) closed by T-066.
