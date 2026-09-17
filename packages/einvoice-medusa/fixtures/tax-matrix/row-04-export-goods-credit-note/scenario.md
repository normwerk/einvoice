# row-04-export-goods-credit-note

Credit note (381) for a full return of `row-04-export-goods` — separate `selectProfile` call site
(`credit-note-on-payment-refunded.ts`), same real adapter functions.

- **Build axis**: reachable, expected **green**, category G.
- **Profile axis**: buyer CH — expected **error**, `UnsupportedCountryError` (**P-13**).

Known bug: **P-13** (profile axis only).
