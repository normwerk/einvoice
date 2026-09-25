# `einvoice-commerce` fixtures

Package-local, distinct from the root [`fixtures/`](../../../fixtures) directory (which is strictly
`Invoice`-model-shaped, per its own README). Each `<id>/input.json` here is a `CommerceInvoiceInput` —
the point is to prove `buildInvoice()` itself, not just `einvoice-model`/`einvoice-cii`.

- `input.json` — a `CommerceInvoiceInput`.
- `vat-id-evidence.json` (optional) — a pre-computed `VatIdEvidence`, standing in for what a real
  `VatIdVerifier.verify()` call would have returned before `buildInvoice` was called (ADR-001/ADR-003:
  `buildInvoice` itself does no I/O). Passed through as `options.vatIdEvidence`.
- `scenario.md` — what the scenario is and which `docs/tax-semantics.md` row it exercises.

Run for real against the KoSIT validator: `pnpm conformance:commerce`
(`tools/conformance/build-commerce-fixtures.mjs`) — builds each fixture with `buildInvoice`, serializes it
with `serializeCii`, and validates the result with the real Docker KoSIT image (AGENTS.md §8: never
simulate conformance).

| Fixture                         | `docs/tax-semantics.md` row | What it proves                                                                                                                     |
| ------------------------------- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `commerce-domestic-mixed-rates` | 1, 2, 9                     | Two lines at different rates → two `BG-23` groups; shipping + discount split per rate                                              |
| `commerce-intra-eu`             | 3                           | Category K, VIES evidence gate, mandatory delivery info (`BR-IC-11`/`BR-IC-12`)                                                    |
| `commerce-credit-note`          | 10                          | `document.kind === "credit-note"` requires `correctedInvoice`                                                                      |
| `commerce-b2g-leitweg-id`       | —                           | Real Leitweg-ID declared as `leitwegId`, validated by its own MOD 97-10 check digit                                                |
| `commerce-customs-hs-origin`    | 1                           | `lines[].hsCode`/`originCountry` (BT-158/159) mapped per-line, not document-wide                                                   |
| `commerce-gross-prices`         | 1, 2, 9                     | Prices including VAT: each group's VAT taken out of its gross total, total = gross charged                                         |
| `commerce-shipment-prepaid`     | 1, 2, 9                     | One shipment of a mixed order: shipping split by the order's rates, a charge-only group; paid in full (BT-113 = total, BT-115 = 0) |
