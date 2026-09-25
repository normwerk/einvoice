# special-territory-northern-ireland

Mandatory rejection: goods to a business in Northern Ireland. Medusa sends the address as `gb` with a
`BT…` postcode; for goods, Northern Ireland is inside the EU VAT area under the Windsor Framework, so the
supply is not the export the country code suggests. By country code alone the order would get category G —
a document every validator accepts, with the wrong category. `buildInvoice` recognises the territory by its
postcode (`specialVatTerritory` in `einvoice-commerce`) and refuses before any category is decided.

- **Build axis**: expected **error**, `TaxRuleError` with code `SPECIAL_VAT_TERRITORY`.
- **Profile axis**: buyer country GB — expected **ok, `EN16931`**; the refusal is about VAT, not the format.

A service to the same buyer is a UK service and is not refused by this check (it reaches row 13).
