# de-fiscal-representative

CH seller with no direct EU VAT registration, represented in Germany by a fiscal representative
(`sellerTaxRepresentative`, BG-11) for German VAT purposes; goods imported via Germany then dispatched
onward to an FR B2B buyer (an intra-Community supply, like `de-eu-intracommunity`, but the seller's side of
the VAT-ID requirement is satisfied through the representative instead of the seller itself). Exercises
BT-62/63/69 — the fields that were missing from `einvoice-model` until the L4 oracle against
`@e-invoice-eu/core` found the gap.

- **Category:** K (Intra-Community supply), 0%
- **Applicable BR-\*:** BR-18 (tax representative name, BT-62 — the field this fixture exists to cover),
  BR-19/BR-20 (tax representative postal address / country code), BR-56 (tax representative VAT
  identifier), BR-IC-\* (same as `de-eu-intracommunity` — BR-IC-02 accepts the seller's VAT-ID **or** the
  seller tax representative's, BT-31/BT-63)
- **Norm source:** German "Fiskalvertretung" (§22a–22e UStG) — a fiscal representative may act for a
  non-EU business whose only taxable transactions in Germany are VAT-exempt (import followed by an exempt
  intra-Community dispatch is the textbook case); informal domain context like the other fixtures'
  paragraph citations (`§4 Nr. 1a`, `§13b UStG`, etc.), not independently verified against a vendored legal
  text the way BT/BG names are.
- **What this specifically tests:** the seller itself has no `vatIdentifier` at all — only the tax
  representative does — so BR-IC-02/03/04 (and BR-CO-09's ISO-3166 prefix check) must be satisfied via
  `sellerTaxRepresentative.vatIdentifier`, not `seller.vatIdentifier`.

All 14 fixtures (this one included) pass the real KoSIT validator (L1 XSD + L2 Schematron,
`pnpm conformance:fixtures`).
