# row-12-eu-b2b-service-credit-note

Credit note (381) for a full return of `row-12-eu-b2b-service` — same order, same result. See that cell's
`scenario.md` for why the refusal is expected.

- **Build axis**: expected **error**, `TaxRuleError` (the category is not decided yet; same message as
  `row-12-eu-b2b-service`).
- **Profile axis**: buyer country FR — expected **ok, `EN16931`**.

No known bug: the refusal is the documented behaviour for this row.
