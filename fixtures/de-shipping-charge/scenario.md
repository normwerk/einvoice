# de-shipping-charge

DE → DE B2B, one invoice line plus shipping cost modeled as a document-level charge (BG-21) — the
"delivery as a charge" scenario.

- **What this exercises:** `Invoice.documentLevelCharges` (BG-21) — the mirror image of
  `de-document-discount`'s allowance: `BR-CO-13` adds instead of subtracting
  (525.00 = 500.00 + 25.00 taxable base). Shipping is not a distinct EN 16931 concept; it is simply a
  charge with a reason text/code, same shape as any other document-level charge.
- **Levels:** L1+L2 verified against the real KoSIT validator (`pnpm conformance:fixtures`).
