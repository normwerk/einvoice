# row-01-domestic-no-vat-charged

`docs/tax-semantics.md` row 1 — a domestic B2B sale on which Medusa charged no VAT at all: the line and the
shipping both carry a tax line at rate 0. A shop whose German tax region has no rate looks like this, and so
does a Kleinunternehmer (§19 UStG) who set Medusa up to charge none.

Row 1 is category S at 19 % or 7 %, and nothing was charged at either. A Kleinunternehmer may always send an
ordinary invoice instead of an e-invoice (§34a Satz 4 UStDV) and is not served by this release; a shop missing
a rate has to fix its settings. The refusal names both, instead of sending a Kleinunternehmer to the tax
settings as the line's own refusal would.

- **Build axis**: expected **error**, `TaxRuleError` with code `NO_VAT_CHARGED` — `buildInvoice` refuses a
  domestic invoice when no line of the order and not its shipping carries a rate above 0 %.
- **Profile axis**: buyer country DE — expected **ok, `EN16931`**.
