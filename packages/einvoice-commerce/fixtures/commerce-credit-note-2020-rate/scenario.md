# commerce-credit-note-2020-rate

`docs/tax-semantics.md` rows 9 and 10 — a credit note, issued today, for an invoice of goods delivered on
2020-08-01, when Germany's rates were 16 % and 5 % (§28 Abs. 1 and 2 UStG). The shop's own tax lines say 19 %
and 7 % (`chargedVatRate`), and so do today's rates; each line carries the rate the invoice stated
(`invoicedVatRate`), and the credit note credits at it — §17 UStG corrects the supply as it was invoiced. The
shipping is split across the two rates in proportion to the lines, as on the invoice. The credit note states
the invoice's delivery date (BT-72).

Expected: one BG-23 group at 16 % and one at 5 %; KoSIT-valid.
