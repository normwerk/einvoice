# row-01-domestic-untaxed-line

`docs/tax-semantics.md` row 1 — a domestic B2B sale, but Medusa charged no VAT on the line: its tax line
has rate 0, which is what a Medusa tax region without a default rate produces.

Row 1 gives category S at 19%, or 7% for goods in Anlage 2 UStG. Neither is what the buyer was charged, and
nothing in the order says which of the two the product is. The adapter passes the charged rate on as a fact
(`chargedVatRate`); it no longer snaps it to the nearer German rate, which turned this line into a 7% line.

- **Build axis**: expected **error**, `TaxRuleError` naming line 1 and its charged 0% — `resolveLineRate`
  refuses a domestic line charged at a rate that is neither 19% nor 7%.
- **Profile axis**: buyer country DE — expected **ok, `EN16931`**.
