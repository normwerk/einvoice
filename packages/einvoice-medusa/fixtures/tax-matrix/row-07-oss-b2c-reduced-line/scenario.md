# row-07-oss-b2c-reduced-line

`docs/tax-semantics.md` row 7 — the same OSS distance sale to a Dutch consumer as `row-07-oss-b2c`, with a
second line: a book, which Medusa taxed at the Netherlands' reduced rate of 9%.

`oss_rate_override` declares one rate for the order — the destination country's standard rate, 21%. A
reduced destination rate cannot be declared, so the book has no rate this package can invoice it at.
Invoicing it at 21% would state more VAT than the buyer was charged, and a German seller owes VAT
stated on an invoice (§14c Abs. 1 UStG).

- **Build axis**: expected **error**, `TaxRuleError` naming line 2 and its charged 9% — `resolveLineRate`
  compares the rate Medusa charged (`items[].tax_lines[].rate`, passed on as `chargedVatRate`) with the
  declared one. The category would be S; it is the rate that cannot be expressed.
- **Profile axis**: buyer country NL — expected **ok, `EN16931`**, same as `row-07-oss-b2c`.
