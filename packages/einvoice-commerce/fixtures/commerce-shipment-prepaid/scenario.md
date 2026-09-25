# commerce-shipment-prepaid

`CommerceInvoiceInput` for the first shipment of an order that was paid in full before it shipped
(`docs/tax-semantics.md` rows 1, 2 and 9). The order holds a book at 7 % and two widgets at 19 %; this
shipment carries the book alone, and the order's shipping with it.

- **Shipping split by the whole order's rates** (`chargeSplitLines`): 10.00 net in proportion to the order's
  lines — 40.00 at 7 %, 100.00 at 19 % — gives 2.86 at 7 % and 7.14 at 19 %. The 19 % VAT breakdown group
  (BG-23) holds that shipping share alone, with no line at that rate on this invoice.
- **Paid in full** (`paidAmount`): BT-113 states the whole total, 54.36, and the amount due (BT-115) is 0.00.
