# commerce-gross-prices

`CommerceInvoiceInput` for a shop whose prices include VAT: every line gives `priceInclVat`, the shipping
`amountInclVat`, and the line allowance is VAT-inclusive too. `buildInvoice` keeps the gross amounts the
buyer was charged — each VAT group's VAT is taken out of the group's gross total and the group's net is
spread over its parts to the cent — so the invoice totals exactly 41.80, the sum of the gross prices
(3 × 10.00 − 3.00 + 10.70 + 4.10).

Expected: two `BG-23` groups. 19%: gross 31.10 (T-shirts 27.00, shipping 4.10), VAT 4.97, taxable 26.13.
7%: gross 10.70, VAT 0.70, taxable 10.00. The 19% group is chosen so the two ways of stating its VAT
disagree: taken out of the gross total it is 4.97, while taxable × rate gives 4.96. `BR-CO-17` and
`BR-S-09` accept a group VAT that differs from taxable × rate by less than 1, and this fixture is what
checks that against the real validator. Shipping takes the 19% group with a warning, the documented
mixed-basket default.
