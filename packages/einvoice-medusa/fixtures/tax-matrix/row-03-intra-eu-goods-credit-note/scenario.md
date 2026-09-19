# row-03-intra-eu-goods-credit-note

Credit note pairing for `row-03-intra-eu-goods` — a return of an intra-EU supply, own `selectProfile`
call site (`credit-note-on-payment-refunded.ts`), own `vat-id-evidence.json`. Same fix as the invoice cell
(T-079: P-12/P-25/P-19 all closed) — build axis now reaches category K here too.

- **Build axis**: expected **ok**, category **K**.
- **Profile axis**: still expected **error**, `UnsupportedCountryError` — **P-13**, owned by T-066.

Known bugs: **P-13** (profile axis only).
