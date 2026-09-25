# special-territory-canary-islands

Mandatory rejection: goods to a business in the Canary Islands, with its VAT-ID and a positive VIES check
(`vat-id-evidence.json`). Medusa sends the address as `es` with a `35…` postcode (Las Palmas); the Canary
Islands are outside the EU VAT area (VAT Directive Art. 6), so the supply is not the intra-EU supply the
country code and the VIES check suggest. By country code alone the order would get category K. `buildInvoice`
recognises the territory by its postcode and refuses before any category is decided — so the refusal is not
hidden behind the VIES check either.

- **Build axis**: expected **error**, `TaxRuleError` with code `SPECIAL_VAT_TERRITORY`.
- **Profile axis**: buyer country ES — expected **ok, `EN16931`**.
