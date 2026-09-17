# row-02-domestic-reduced

`docs/tax-semantics.md` row 2 — DE→DE B2B, reduced rate (books, `UStG §12 Abs. 2 Nr. 1` + Anlage 2).
Category **S**, 7%. Same `BR-S-*` rules as row 1 — only the rate differs (`inferTaxRateKind` picks "reduced"
because the captured tax line rate, 7, is closer to `DE_REDUCED_RATE` than `DE_STANDARD_RATE`).

- **Build axis**: reachable, expected **green**, category S.
- **Profile axis**: DE buyer, no B2G reference — expected **green**, `EN16931`.

No known bug involved.
