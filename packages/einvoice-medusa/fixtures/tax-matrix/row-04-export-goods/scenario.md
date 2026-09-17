# row-04-export-goods

`docs/tax-semantics.md` row 4 — DE→CH (non-EU), goods. Category **G**, 0% (`VATEX-EU-G`,
`§4 Nr. 1a, §6 UStG`). `decideVatCategory`'s export branch only checks `!buyerIsEu` — no override or
VAT-ID evidence needed, unlike K — so this is the one cross-border category the tax logic _can_ reach
correctly through today's real adapter.

- **Build axis**: reachable, expected **green**, category G. The tax logic itself is correct here — worth
  calling out explicitly, since every other cross-border cell in this matrix is red.
- **Profile axis**: buyer country CH ≠ DE — expected **error**, `UnsupportedCountryError` (**P-13**,
  `selectProfile` rejects every non-German buyer unconditionally, `packages/einvoice-commerce/src/profile.ts`).
  In the real subscriber pipeline `selectProfile` runs _before_ `buildInvoice`, so in production this order
  would never reach the (correct) build-axis result above — P-13 masks a working piece of tax logic here,
  not a broken one, which is exactly why the two axes are checked independently (see `types.ts`'s doc
  comment).

Known bug: **P-13** (profile axis only).
