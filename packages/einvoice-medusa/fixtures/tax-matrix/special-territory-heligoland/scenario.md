# special-territory-heligoland

Mandatory rejection: a German business billed in Hamburg, goods delivered to Heligoland (`de`, postcode
`27498`). Heligoland is outside the German VAT area (§1 Abs. 2 UStG), so the delivery is not the domestic
supply at 19 % the country code suggests — the one special territory a German shop meets on an order that
looks entirely domestic. Goods are placed where they go, so the shipping address decides, not the billing
one.

- **Build axis**: expected **error**, `TaxRuleError` with code `SPECIAL_VAT_TERRITORY`.
- **Profile axis**: buyer country DE — expected **ok, `EN16931`**.
