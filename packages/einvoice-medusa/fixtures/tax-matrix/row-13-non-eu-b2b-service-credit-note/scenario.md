# row-13-non-eu-b2b-service-credit-note

Credit note pairing for `row-13-non-eu-b2b-service` — same fix, same result. See that cell's `scenario.md`
for the full history.

- **Build axis**: expected **error**, `TaxRuleError` (CONTESTED, same message as `row-13-non-eu-b2b-service`).
- **Profile axis**: expected **error**, `UnsupportedCountryError` — unchanged by T-066 (see that cell's
  `scenario.md`: the US falls into the generic "everything else" refusal, not a bug).

No known bugs remain on this cell as of T-066.
