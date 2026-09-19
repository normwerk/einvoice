# row-06-exempt

`docs/tax-semantics.md` row 6 — DE domestic, exempt supply (§4 UStG — medical treatment, §4 Nr. 14, used
here as a concrete, unambiguous example). Category **E**, 0%.

**T-069 closed P-14.** `order.metadata.regime_override: { kind: "exempt", reasonText: "Steuerfreie
Heilbehandlung gemäß §4 Nr. 14 UStG" }` is now threaded through by `mapOrderToCommerceInvoiceInput`, so
`decideVatCategory`'s exempt branch is reachable through the real adapter. `resolveLineRate` fixes every
non-S category's rate to `"0"` directly — the compounding "reduced-rate guess for a 0% line" quirk this
cell's earlier `scenario.md` documented no longer matters once E is the resolved category (it was always
only visible because the mapper's per-line rate inference ran for a wrongly-resolved S).

- **Build axis**: expected **ok**, category **E**.
- **Profile axis**: DE buyer, no B2G reference — expected **ok**, `EN16931`.

No known bugs remaining on this cell.
