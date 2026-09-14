# de-document-discount

DE → DE B2B, one invoice line plus a document-level allowance (BG-20), e.g. a loyalty discount applied
after the line total.

- **What this exercises:** `Invoice.documentLevelAllowances` (BG-20), already modeled/wired since T-020,
  exercised by a fixture for the first time here. The allowance carries its own VAT category/rate
  (`BT-95`/`BT-96`) since it changes the taxable base for that category — `BR-CO-13`: taxable amount
  (`BT-116`) = sum of line net amounts (`BT-106`) − sum of allowances (`BT-107`) [+ charges], so
  950.00 = 1000.00 − 50.00.
- **T-027:** also exercises `baseAmount` (`BT-93`) + `calculationPercent` (`BT-94`) together — 5% of
  the 1000.00 base gives the 50.00 allowance amount. Originally this fixture omitted `baseAmount`
  entirely to dodge `PEPPOL-EN16931-R042` ("Allowance/charge percentage MUST be provided when
  allowance/charge base amount is provided"), since `calculationPercent` had no model field yet — now
  that it does (T-027), the pair is used together instead of avoided.
- **Levels:** L1+L2 verified against the real KoSIT validator (`pnpm conformance:fixtures`).
