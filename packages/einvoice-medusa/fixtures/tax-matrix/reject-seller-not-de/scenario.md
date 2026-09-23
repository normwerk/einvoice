# reject-seller-not-de

Mandatory rejection: `decideVatCategory` refuses any `sellerCountry !== "DE"` unconditionally, before any
buyer-side logic runs (`tax-rules.ts` — this release covers a German seller only). Uses the `fr` seller from
`_shared/sellers.json`; the buyer is deliberately DE so the **profile axis** stays green and cannot be
confused with the seller-side guard this cell is about.

- **Build axis**: expected **error**, `TaxRuleError` ("only covers a German seller"). This cell is not a
  bug report — it proves the seller-side refusal stays wired.
- **Profile axis**: DE buyer, no B2G reference — expected **green**, `EN16931`.

No known bug involved.
