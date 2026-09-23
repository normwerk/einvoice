# row-04-export-goods

`docs/tax-semantics.md` row 4 — DE→CH (non-EU), goods. Category **G**, 0% (`VATEX-EU-G`,
`§4 Nr. 1a, §6 UStG`). `decideVatCategory`'s export branch only checks `!buyerIsEu` and that the supply is
not a service — no override or VAT-ID evidence needed, unlike K. The goods are delivered to CH (the billing
address; the order has no separate shipping address), outside the EU, so `buildInvoice`'s check that an
export actually leaves the EU passes too.

- **Build axis**: reachable, expected **green**, category G.
- **Profile axis**: buyer country CH — expected **ok, `EN16931`**. Switzerland has no e-invoice mandate or
  clearance system of its own, so it is one of the two non-EU/EEA countries (with the UK) `selectProfile`
  accepts (`packages/einvoice-commerce/src/profile.ts`). In the real subscriber pipeline `selectProfile`
  runs _before_ `buildInvoice`, so a refusal there would hide a correct build-axis result — exactly why the
  two axes are checked independently (see `types.ts`'s doc comment).

No known bug involved.
