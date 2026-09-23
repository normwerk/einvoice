# row-07-oss-b2c-service

`docs/tax-semantics.md` row 7 — the same OSS-registered merchant and Dutch consumer as `row-07-oss-b2c`,
with the destination rate declared (`oss_rate_override: "21"`), but the order is a service: its one line
has `requires_shipping: false`, so the adapter derives `supplyType: "services"`.

Row 7 covers distance sales of goods. A service to a consumer is taxed where the seller is as a rule
(§3a Abs. 1 UStG); only the services §3a Abs. 5 UStG lists — telecommunications, broadcasting,
electronically supplied services — are taxed in the consumer's country. An order does not say which kind
of service it is, so there is no single category to give it.

- **Build axis**: expected **error**, `TaxRuleError` (mentions "§3a Abs. 5 UStG") — `decideVatCategory`
  refuses an OSS sale of services instead of taxing it at the declared destination rate.
- **Profile axis**: buyer country NL — expected **ok, `EN16931`**, same as `row-07-oss-b2c`.
