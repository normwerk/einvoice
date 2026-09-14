# de-line-discount

DE → DE B2B, one invoice line with a line-level allowance (BG-27), e.g. a volume discount.

- **What this exercises:** `InvoiceLine.allowances` (BG-27) — `BT-131` (the line's net amount) is the
  **post-discount** total (1000.00 gross − 100.00 discount = 900.00), not the pre-discount price × quantity;
  the discount itself is recorded separately (`BT-136` amount, `BT-137` base amount, `BT-139`/`BT-140`
  reason). `CII` binding: `SpecifiedLineTradeSettlement/SpecifiedTradeAllowanceCharge`
  (`ChargeIndicator=false`), added in T-022 alongside the document-level equivalent from T-020/T-021.
- **Levels:** L1+L2 verified against the real KoSIT validator (`pnpm conformance:fixtures`).
