# row-04-export-goods

`docs/tax-semantics.md` row 4 — DE→CH (non-EU), goods. Category **G**, 0% (`VATEX-EU-G`,
`§4 Nr. 1a, §6 UStG`). `decideVatCategory`'s export branch only checks `!buyerIsEu` — no override or
VAT-ID evidence needed, unlike K — so this is the one cross-border category the tax logic _can_ reach
correctly through today's real adapter.

- **Build axis**: reachable, expected **green**, category G. The tax logic itself is correct here — worth
  calling out explicitly, since every other cross-border cell in this matrix is red.
- **Profile axis**: buyer country CH — expected **ok, `EN16931`**. Was `error`, `UnsupportedCountryError`
  (**P-13** — `selectProfile` rejected every non-German buyer unconditionally,
  `packages/einvoice-commerce/src/profile.ts`) until **T-066** closed it: Switzerland has no e-invoice
  mandate or clearance system of its own, so it's one of the two non-EU/EEA countries (with the UK)
  `selectProfile` still accepts. Before the fix, `selectProfile` running _before_ `buildInvoice` in the real
  subscriber pipeline meant production would never have reached the (correct) build-axis result above —
  P-13 masked a working piece of tax logic here, not a broken one, exactly why the two axes are checked
  independently (see `types.ts`'s doc comment).

No known bugs remain on this cell as of T-066.
