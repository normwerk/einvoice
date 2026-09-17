# row-01-domestic-standard-credit-note

`docs/tax-semantics.md` row 10 — credit note (381) for a full return of a domestic S/19% invoice, paired
with `row-01-domestic-standard`. Exercises `credit-note-on-payment-refunded.ts`'s own `selectProfile` call
site (textually separate from the invoice subscriber's, though currently the same logic) and `buildInvoice`'s
`document.kind === "credit-note"` path, which requires `document.correctedInvoice` (T-064,
`MissingCorrectedInvoiceReferenceError` if absent — already unit-tested directly in
`packages/einvoice-commerce/src/build-invoice.test.ts`, not re-proven here).

Row 10's own caveat — `BR-55` never forces `BT-25` (`correctedInvoice`) presence on a credit note; this
package enforces it itself rather than relying on the validator — is already closed by the guard above, not
a live bug this cell needs to demonstrate.

- **Build axis**: reachable, expected **green**, category S (same regime as the original invoice).
- **Profile axis**: DE buyer, no B2G reference — expected **green**, `EN16931`.

No known bug involved.
