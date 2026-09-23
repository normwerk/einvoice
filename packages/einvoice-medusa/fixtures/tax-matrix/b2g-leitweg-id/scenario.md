# b2g-leitweg-id

A domestic sale to a German public-sector buyer (`docs/tax-semantics.md` row 1 for the category). The
merchant declared the buyer's Leitweg-ID in `customer.metadata.leitweg_id` — the worked example of the
KoSIT "Leitweg-ID Format-Spezifikation Version 2.0.2" (§2.4), `04011000-1234512345-06`.

- **Build axis**: expected **ok, `S`** — the adapter passes the Leitweg-ID as `references.leitwegId`;
  `buildInvoice` validates its check digits and writes it to BT-10.
- **Profile axis**: expected **ok, `XRECHNUNG`** — a declared Leitweg-ID is the B2G signal, and a public-sector
  buyer takes pure XML, not a hybrid PDF.

The counterpart `b2g-order-reference-not-leitweg-id` shows that a reference merely shaped like a
Leitweg-ID is not one.
