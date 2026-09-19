# row-05-reverse-charge

`docs/tax-semantics.md` row 5 — DE→DE B2B, reverse charge (§13b UStG, subcontracted construction work).
Category **AE**, 0%, with the mandatory `VATEX-EU-AE` text "Steuerschuldnerschaft des Leistungsempfängers"
(`BR-AE-02` also requires both parties' VAT-ID/legal-registration identifier).

**T-069 closed P-14** — `order.metadata.regime_override: { kind: "reverse-charge" }` (this plugin's own
convention, `docs/mapping-reference-medusa.md`) is now threaded through by `mapOrderToCommerceInvoiceInput`,
so `decideVatCategory`'s AE branch is reachable through the real, unmocked adapter for the first time.

**This cell's own prior `scenario.md` predicted exactly what happened next, and it was right.** Its earlier
text (before T-069) said: _"once T-069 threads `regimeOverride` through, re-run this cell; if it doesn't turn
fully green, that guard gap is why"_ — referring to T-079's `BR-AE-02` guard (`MissingBuyerIdentifierForReverseChargeError`).
The first re-run with `regimeOverride` wired did exactly that: this order's buyer (`Bau GmbH`) had no
`customer.metadata.vat_id` and the mapper has no `legalRegistrationIdentifier` source at all, so the guard
fired for real — not a code gap, a genuine missing fact in this synthetic fixture's own data (a real German
B2B subcontractor doing construction work would have one or the other). Fixed by adding
`customer.metadata.vat_id: "DE987654321"` to `order.json`, matching the same buyer VAT-ID
`packages/einvoice-commerce`'s own `de-b2b-reverse-charge` root fixture already uses for this exact scenario.

- **Build axis**: expected **ok**, category **AE**.
- **Profile axis**: DE buyer, no B2G reference — expected **ok**, `EN16931`.

No known bugs remaining on this cell.
