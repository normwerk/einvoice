# row-05-reverse-charge

`docs/tax-semantics.md` row 5 — DE→DE B2B, reverse charge (§13b UStG, subcontracted construction work).
Category **AE**, 0%, with the mandatory `VATEX-EU-AE` text "Steuerschuldnerschaft des Leistungsempfängers"
(`BR-AE-02` also requires both parties' VAT-ID/legal-registration identifier).

`order.metadata.regime_override: { kind: "reverse-charge" }` (this plugin's own convention,
`docs/mapping-reference-medusa.md`) is carried through by `mapOrderToCommerceInvoiceInput` into
`taxContext.regimeOverride`, so `decideVatCategory`'s AE branch is reached through the real, unmocked
adapter.

**Why the buyer carries a VAT-ID.** `buildInvoice` refuses category AE without a buyer VAT-ID or legal
registration identifier (`BR-AE-02`, `MissingBuyerIdentifierForReverseChargeError`), and the mapper has no
source for a legal registration identifier at all — so without `customer.metadata.vat_id` this order would
be refused. That is a missing fact in the synthetic data, not a code gap: a real German B2B subcontractor
doing construction work would have one or the other. The buyer (`Bau GmbH`) therefore carries
`customer.metadata.vat_id: "DE987654321"`, the same buyer VAT-ID the root fixture
`fixtures/de-b2b-reverse-charge/` uses for this scenario.

- **Build axis**: expected **ok**, category **AE**.
- **Profile axis**: DE buyer, no B2G reference — expected **ok**, `EN16931`.

No known bug involved.
