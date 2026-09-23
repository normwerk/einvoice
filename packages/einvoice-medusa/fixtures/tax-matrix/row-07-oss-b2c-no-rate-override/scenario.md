# row-07-oss-b2c-no-rate-override

`docs/tax-semantics.md` row 7 — same order as `row-07-oss-b2c` (DE→NL, B2C distance sale, merchant
OSS-registered via `ossRegistered: true` in `map-options.json`), but with no `order.metadata.oss_rate_override`
— the mandatory-rejection twin of that cell, the same way `row-03-intra-eu-goods-no-vat-id-evidence` pairs
with `row-03-intra-eu-goods`.

The adapter carries OSS registration through from merchant configuration
(`EinvoiceModuleOptions.ossRegistered` → `MapOrderOptions.ossRegistered` → `taxContext.ossRegistered`), so
the OSS branch is reachable through the real adapter. Registration alone is not enough:
`decideVatCategory` also needs the destination country's rate (`docs/tax-semantics.md` row 7: no vendored EU
rate table), and this cell proves that guard holds through the adapter, not only in
`packages/einvoice-commerce`'s unit tests.

- **Build axis**: expected **error**, `TaxRuleError` ("needs taxContext.ossRateOverride") —
  `decideVatCategory`'s own refusal (`einvoice-commerce`): `ossRegistered: true` with no declared rate means
  no category S via the OSS branch, by design (this package never guesses a member state's VAT rate).
- **Profile axis**: buyer country NL — expected **ok, `EN16931`**, same as `row-07-oss-b2c`.

No known bug: the build axis's refusal is the documented behaviour, not a bug.
