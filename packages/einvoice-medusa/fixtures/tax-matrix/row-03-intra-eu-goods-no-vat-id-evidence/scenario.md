# row-03-intra-eu-goods-no-vat-id-evidence

`docs/tax-semantics.md` row 3 — same order as `row-03-intra-eu-goods` (DE→FR B2B, buyer VAT-ID given, goods),
but with no `vat-id-evidence.json` — the mandatory-rejection twin T-079 split out of `row-03-intra-eu-goods`
itself.

Before T-079, `row-03-intra-eu-goods`'s own `scenario.md` doubled this cell into the base one: "there is no
synthetic order shape that could reach K _with_ evidence through today's real adapter, so a separate
rejection fixture would be redundant" — category K was unreachable at all (P-12), so every K-shaped order,
evidence or not, produced the same `TaxRuleError`. T-079 wires `VatIdVerifier` into the adapter
(`EinvoiceModuleOptions.vatIdVerifier`, both subscribers), closes `MissingDeliveryInfoForIntraCommunitySupplyError`
(P-25: `delivery` now mapped from `shipping_address`/`billing_address`) and adds the missing `BR-IC-02` guard
(P-19) — `row-03-intra-eu-goods` itself now reaches category K for real. That made the "no evidence"
rejection genuinely redundant no longer: this cell is what still proves it.

- **Build axis**: expected **error**, `TaxRuleError` ("needs a positive VIES check") — `decideVatCategory`'s
  own refusal (`einvoice-commerce`), unchanged by T-079: no `vatIdEvidence` and no
  `regimeOverride: { kind: "intra-eu-confirmed" }` still means no category K, by design (D-19).
- **Profile axis**: buyer country FR ≠ DE — expected **error**, `UnsupportedCountryError`, same known bug
  **P-13** as `row-03-intra-eu-goods`, still owned by T-066.

Known bugs: **P-13** (profile axis only — the build axis here is spec-correct refusal, not a bug).
