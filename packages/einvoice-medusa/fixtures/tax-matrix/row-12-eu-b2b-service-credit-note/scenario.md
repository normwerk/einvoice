# row-12-eu-b2b-service-credit-note

Credit note pairing for `row-12-eu-b2b-service` — same fix, same result. See that cell's `scenario.md` for
the full two-step de-confounding history.

- **Build axis**: expected **error**, `TaxRuleError` (M-006, same message as `row-12-eu-b2b-service`).
- **Profile axis**: expected **ok, `EN16931`** — was **P-13** (`UnsupportedCountryError`) until T-066
  closed it.

No known bugs remain on the profile axis as of T-066.
