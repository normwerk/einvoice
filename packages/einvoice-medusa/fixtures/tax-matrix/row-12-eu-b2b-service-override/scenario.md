# row-12-eu-b2b-service-override

`docs/tax-semantics.md` row 12 — DE→FR B2B, service — same scenario as `row-12-eu-b2b-service`, except this
order carries `order.metadata.regime_override: { kind: "reverse-charge-cross-border" }`.

`row-12-eu-b2b-service` proves the _default_ behaviour is a refusal while the category is not decided.
Without this override that refusal would be a dead end: row 5's `reverse-charge` override explicitly
rejects any non-DE buyer (`docs/tax-semantics.md` row 5 is DE→DE only). This cell proves row 12 has the
same escape hatch K has (row 3's `intra-eu-confirmed` override): a merchant who has decided the fact for
themselves is not blocked by the code's own refusal to guess.

- **Build axis**: expected **ok, AE** — `decideVatCategory`'s `reverse-charge-cross-border` branch
  (`tax-rules.ts`), checked ahead of the default row-12 refusal, returns `VATEX-EU-AE` with
  `ruleId: "tax-semantics#12"`. The buyer carries a VAT-ID (`customer.metadata.vat_id`), which
  `buildInvoice` requires twice over: `BR-AE-02` (`MissingBuyerIdentifierForReverseChargeError` otherwise,
  as on `row-05` without its buyer VAT-ID) and §14a Abs. 1 UStG, which needs the VAT-ID itself, not only a
  legal registration identifier (`MissingBuyerVatIdForCrossBorderServiceError`).
- **Profile axis**: buyer country FR — expected **ok, `EN16931`**, like every other EU buyer in this
  matrix.

No known bug involved.
