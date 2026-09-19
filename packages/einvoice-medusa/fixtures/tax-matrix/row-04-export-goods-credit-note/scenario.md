# row-04-export-goods-credit-note

Credit note (381) for a full return of `row-04-export-goods` — separate `selectProfile` call site
(`credit-note-on-payment-refunded.ts`), same real adapter functions.

- **Build axis**: reachable, expected **green**, category G.
- **Profile axis**: buyer CH — expected **ok, `EN16931`** — was **P-13** (`UnsupportedCountryError`) until
  T-066 closed it; Switzerland has no clearance system of its own.

No known bugs remain on this cell as of T-066.
