# row-07-oss-b2c

`docs/tax-semantics.md` row 7 — DE→NL, B2C distance sale under the OSS one-stop-shop scheme. Category **S**
at the buyer country's own rate (Art. 33 VAT Directive), supplied by the caller via
`taxContext.ossRateOverride` since this package doesn't maintain an EU rate table.

`decideVatCategory`'s OSS branch additionally requires `taxContext.ossRegistered === true`. **Before T-136,
the adapter hardcoded `ossRegistered: false` for every order** (`order-to-commerce-invoice-input.ts`) — there
was no config or order-level source for it at all, so the branch condition could never be true through the
real adapter, and this cell fell all the way through to `decideVatCategory`'s own final refusal. Found as a
new finding beyond the five named bugs during T-117's first run, queued as **P-26**
(`ecom docs/plan-v0.1-pending.md`).

**T-136 closes it**, mirroring the "declared fact, never inferred" shape category K's `intra-eu-confirmed`
override and row 12's `reverse-charge-cross-border` override already use — except OSS needs two facts, at
two different tiers, not one `RegimeOverride` variant: (1) **OSS registration** is a standing fact about the
_merchant_, so it lives in `EinvoiceModuleOptions.ossRegistered` (`service.ts`), the same tier as
`seller`/`payment`, threaded through `MapOrderOptions.ossRegistered` — this fixture's `map-options.json` sets
it `true`. (2) **the destination-country rate** is a fact about _this order_, so it lives on
`order.metadata.oss_rate_override` (mirroring `regime_override`'s own placement rationale) — this fixture's
`order.json` sets it to `"21"`, the Netherlands' real standard VAT rate, not a placeholder. Neither fact is
looked up or guessed by this package itself (`TaxContext.ossRateOverride`'s own doc comment: no vendored EU
rate table); both are declared by the caller, exactly as the guard already required before T-136 — T-136
gives the adapter a way to _satisfy_ that guard, not a way around it.

- **Build axis**: expected **ok, `S`** — `decideVatCategory`'s row-7 branch now matches (seller DE, buyer NL
  inside the EU, B2C, `ossRegistered: true`) and resolves the line at the declared 21% rate
  (`resolveLineRate` returns `ossRateOverride` verbatim for `ruleId: "tax-semantics#7"`, ignoring the line's
  own captured `tax_lines[].rate`/`taxRateKind`). **P-26 closed.**
- **Profile axis**: buyer country NL — expected **ok, `EN16931`**. Was `error`, `UnsupportedCountryError`
  (**P-13**, masking P-26 in the real production call order, same relationship as row 3/P-12) until **T-066**
  closed it; the Netherlands is an EU member state.

No known bugs remain on this cell as of T-136. The mandatory-rejection half this cell used to double as
("OSS without `ossRateOverride`") now has its own dedicated fixture, `row-07-oss-b2c-no-rate-override` —
this cell alone can no longer demonstrate a rejection it no longer produces.
