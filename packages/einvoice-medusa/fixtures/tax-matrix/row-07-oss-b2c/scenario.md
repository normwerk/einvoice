# row-07-oss-b2c

`docs/tax-semantics.md` row 7 — DE→NL, B2C distance sale under the OSS one-stop-shop scheme. Category **S**
at the buyer country's own rate (Art. 33 VAT Directive), supplied by the caller via
`taxContext.ossRateOverride` since this package doesn't maintain an EU rate table.

`decideVatCategory`'s OSS branch additionally requires `taxContext.ossRegistered === true`. The adapter
defaults it to `false` — "not OSS-registered" — unless the merchant declares otherwise, so this order
reaches the OSS branch only because the merchant's registration is declared.

**Two declared facts, at two tiers.** The same "declared fact, never inferred" shape category K's
`intra-eu-confirmed` override and row 12's `reverse-charge-cross-border` override use — except OSS needs two
facts, not one `RegimeOverride` variant: (1) **OSS registration** is a standing fact about the _merchant_,
so it lives in `EinvoiceModuleOptions.ossRegistered` (`service.ts`), the same tier as `seller`/`payment`,
threaded through `MapOrderOptions.ossRegistered` — this fixture's `map-options.json` sets it `true`.
(2) **the destination-country rate** is a fact about _this order_, so it lives on
`order.metadata.oss_rate_override` (mirroring `regime_override`'s own placement rationale) — this fixture's
`order.json` sets it to `"21"`, the Netherlands' real standard VAT rate, not a placeholder. Neither fact is
looked up or guessed by this package itself (`TaxContext.ossRateOverride`'s own doc comment: no vendored EU
rate table); both are declared by the caller. The adapter gives the caller a way to _satisfy_ the guard,
not a way around it.

- **Build axis**: expected **ok, `S`** — `decideVatCategory`'s row-7 branch matches (seller DE, buyer NL
  inside the EU, B2C, `ossRegistered: true`) and resolves the line at the declared 21% rate
  (`resolveLineRate` returns `ossRateOverride` for `ruleId: "tax-semantics#7"` after checking that the rate
  Medusa charged on the line, `tax_lines[].rate`, is that same 21%).
- **Profile axis**: buyer country NL — expected **ok, `EN16931`**; the Netherlands is an EU member state.

No known bug involved. The mandatory rejections have their own cells: `row-07-oss-b2c-no-rate-override`
(no declared rate), `row-07-oss-b2c-reduced-line` (a line charged at another rate) and
`row-07-oss-b2c-service` (a service).
