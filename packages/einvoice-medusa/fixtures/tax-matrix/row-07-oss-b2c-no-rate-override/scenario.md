# row-07-oss-b2c-no-rate-override

`docs/tax-semantics.md` row 7 — same order as `row-07-oss-b2c` (DE→NL, B2C distance sale, merchant
OSS-registered), but with no `order.metadata.oss_rate_override` — the mandatory-rejection twin **T-136**
split out of `row-07-oss-b2c` itself, the same way `row-03-intra-eu-goods-no-vat-id-evidence` split out of
`row-03-intra-eu-goods`.

Before T-136, `row-07-oss-b2c`'s own `scenario.md` doubled this cell into the base one: `ossRegistered` was
hardcoded `false`, so the OSS branch could never even be reached, and "OSS without `ossRateOverride`" had no
real fixture proving it — `decideVatCategory`'s own guard (`docs/tax-semantics.md` row 7: no vendored EU
rate table) was only unit-tested in `packages/einvoice-commerce`, never through the real adapter. T-136 makes
`ossRegistered` reachable (`EinvoiceModuleOptions.ossRegistered` → `MapOrderOptions.ossRegistered` →
`taxContext.ossRegistered`), which made the "no rate declared" rejection genuinely testable through the
adapter for the first time — this cell is what proves the guard still holds now that registration alone is
no longer the blocker.

- **Build axis**: expected **error**, `TaxRuleError` ("needs taxContext.ossRateOverride") —
  `decideVatCategory`'s own refusal (`einvoice-commerce`), unchanged by T-136: `ossRegistered: true` with no
  declared rate still means no category S via the OSS branch, by design (this package never guesses a
  member state's VAT rate).
- **Profile axis**: buyer country NL — expected **ok, `EN16931`**, same fix (**T-066** closed **P-13**) as
  `row-07-oss-b2c`.

No known bugs on this cell — the build axis's refusal is spec-correct by design, not a bug.
