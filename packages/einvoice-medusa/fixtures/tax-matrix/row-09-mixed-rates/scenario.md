# row-09-mixed-rates

`docs/tax-semantics.md` row 9 — standard (19%) and reduced (7%) rate lines on one domestic DE→DE invoice.
Not a separate regime: still category **S**, resolved once at the document level; `resolveLineRate` picks
the rate per line from each line's own `taxRateKind` (inferred by the mapper from the captured tax line
rate), producing two `BG-23` VAT-breakdown groups.

- **Build axis**: reachable, expected **green**, category S, two-line order.
- **Profile axis**: DE buyer, no B2G reference — expected **green**, `EN16931`.

No known bug involved.
