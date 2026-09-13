# de-eu-intracommunity

DE seller → FR B2B buyer, goods dispatched to France, buyer's VAT-ID given. Corresponds to row 3 of
[`docs/tax-semantics.md`](../../docs/tax-semantics.md).

- **Category:** K (Intra-Community supply), 0%
- **Applicable BR-\*:** BR-IC-01, BR-IC-02, BR-IC-05, BR-IC-08, BR-IC-09, BR-IC-10, BR-IC-11 (needs
  `delivery.actualDeliveryDate` or an invoicing period), BR-IC-12 (needs `delivery.deliverToCountryCode`)
- **Norm source:** UStG §4 Nr. 1b + §6a; Art. 138 VAT Directive
- **What the validator does not catch:** BR-IC-02 only requires the **seller's** VAT-ID — the buyer's
  (`BT-48`, present here) is not structurally enforced by the base rule set, even though the Art. 138
  exemption is only fiscally valid with one. See `docs/tax-semantics.md`'s "what the validator does not
  catch" section.
- **Levels:** L1–L5 once `einvoice-cii` (T-020) and the conformance suite (T-040) exist. Currently: valid
  against `einvoice-model`'s generated JSON Schema only (`validateModel()`).

`expected/` is empty until T-020 produces a golden CII XML for this input.
