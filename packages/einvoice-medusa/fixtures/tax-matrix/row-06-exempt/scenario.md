# row-06-exempt

`docs/tax-semantics.md` row 6 — DE domestic, exempt supply (§4 UStG — medical treatment, §4 Nr. 14, used
here as a concrete, unambiguous example). Category **E**, 0%.

`order.metadata.regime_override: { kind: "exempt", reasonText: "Steuerfreie Heilbehandlung gemäß §4 Nr. 14
UStG" }` is carried through by `mapOrderToCommerceInvoiceInput`, so `decideVatCategory`'s exempt branch is
reached through the real adapter; the buyer is in Germany, as this domestic-only override requires.
`resolveLineRate` fixes every non-S category's rate to `"0"` directly, so the line's captured tax rate plays
no part in the result.

- **Build axis**: expected **ok**, category **E**.
- **Profile axis**: DE buyer, no B2G reference — expected **ok**, `EN16931`.

No known bug involved.
