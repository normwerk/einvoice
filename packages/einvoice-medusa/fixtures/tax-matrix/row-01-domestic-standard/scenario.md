# row-01-domestic-standard

`docs/tax-semantics.md` row 1 — DE→DE B2B, standard rate. Category **S**, 19% (`UStG §12 Abs. 1`).

Entry point: `mapOrderToCommerceInvoiceInput` (not `buildInvoice` directly, T-117's own point) with a plain
domestic Medusa order — one line, standard-rate tax line, business buyer (`customer.company_name` set).

- **Build axis** (mapper → `buildInvoice`): reachable today, no adapter gap in the way — expected **green**,
  category S.
- **Profile axis** (mapper's B2G signal → `selectProfile`): buyer country DE, no `buyer_reference` in
  `customer.metadata` — expected **green**, `EN16931` (no Leitweg-ID present, so not `XRECHNUNG`).

No known bug involved. This cell (and its credit-note pair) is the pilot proving the harness itself works
against the real KoSIT validator before the rest of the matrix is built out.
