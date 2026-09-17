# reject-seller-not-de

Mandatory rejection: `decideVatCategory` refuses any `sellerCountry !== "DE"` unconditionally, before any
buyer-side logic runs (`tax-rules.ts`, `STRATEGY.md` §2 — v0.1 is Germany-only). Uses the `fr` seller from
`_shared/sellers.json`; the buyer is deliberately DE so the **profile axis** stays green and doesn't mask
the point of this cell (unlike every cross-border backbone row, where `selectProfile`'s own P-13 bug would
otherwise be the only visible failure).

- **Build axis**: expected **error**, `TaxRuleError` ("only covers a German seller"). This guard already
  works correctly today — this cell is not a bug report, it's proof the one rejection that _is_ wired
  correctly stays wired correctly.
- **Profile axis**: DE buyer, no B2G reference — expected **green**, `EN16931`.

No known bug involved.
