# row-03-intra-eu-goods-credit-note

Credit note (381) for a full return of `row-03-intra-eu-goods` — an intra-EU supply, with the credit-note
path's own `selectProfile` call (`src/credit-notes/issue-credit-note.ts`) and its own
`vat-id-evidence.json` (the credit-note path runs the VIES check before `buildInvoice` too). Everything that
lets the invoice cell reach category K — the VIES result, the mapped delivery information, the buyer VAT-ID
on the document — applies here as well, so the build axis reaches category K.

- **Build axis**: expected **ok**, category **K**.
- **Profile axis**: buyer country FR — expected **ok, `EN16931`**; France is an EU member state.

No known bug involved.
