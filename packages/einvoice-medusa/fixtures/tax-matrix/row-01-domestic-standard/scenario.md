# row-01-domestic-standard

`docs/tax-semantics.md` row 1 — DE→DE B2B, standard rate. Category **S**, 19% (`UStG §12 Abs. 1`).

Entry point: `mapOrderToCommerceInvoiceInput` (not `buildInvoice` directly — the point of this matrix is to
prove the adapter) with a plain domestic Medusa order — one line, standard-rate tax line, business buyer
(`customer.company_name` set).

- **Build axis** (mapper → `buildInvoice`): reachable, no adapter gap in the way — expected **green**,
  category S.
- **Profile axis** (mapper's B2G signal → `selectProfile`): buyer country DE, no `buyer_reference` in
  `customer.metadata` — expected **green**, `EN16931` (no Leitweg-ID present, so not `XRECHNUNG`).

No known bug involved. This cell and its credit-note pair are the matrix's baseline: the simplest order the
harness runs end to end, including through the real KoSIT validator in the Docker gate.
