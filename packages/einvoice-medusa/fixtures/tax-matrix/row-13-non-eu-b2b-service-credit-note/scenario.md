# row-13-non-eu-b2b-service-credit-note

Credit note (381) for a full return of `row-13-non-eu-b2b-service` — same order, same result. See that
cell's `scenario.md` for why both axes refuse.

- **Build axis**: expected **error**, `TaxRuleError` (CONTESTED, same message as `row-13-non-eu-b2b-service`).
- **Profile axis**: expected **error**, `UnsupportedCountryError` — the US falls into `profile.ts`'s branch
  5, "anything else", a buyer country this release does not serve yet; not a bug.

No known bug: both axes are documented refusals.
