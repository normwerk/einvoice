# reject-seller-not-de

Mandatory rejection: `decideVatCategory` refuses any `sellerCountry !== "DE"` unconditionally, before any
buyer-side logic runs (`tax-rules.ts`, `STRATEGY.md` §2 — v0.1 is Germany-only). Uses the `fr` seller from
`_shared/sellers.json`; the buyer is deliberately DE so the **profile axis** stays green and doesn't mask
the point of this cell (before **T-066** closed **P-13**, every cross-border backbone row had
`selectProfile`'s own unconditional non-DE-buyer refusal as the only visible failure — that's no longer the
case, but the buyer here is kept DE regardless, since this cell's own point is the seller-side guard).

- **Build axis**: expected **error**, `TaxRuleError` ("only covers a German seller"). This guard already
  works correctly today — this cell is not a bug report, it's proof the one rejection that _is_ wired
  correctly stays wired correctly.
- **Profile axis**: DE buyer, no B2G reference — expected **green**, `EN16931`.

No known bug involved.
