# commerce-b2g-leitweg-id

`CommerceInvoiceInput` for a German public-sector (B2G) buyer with a real Leitweg-ID declared as
`references.leitwegId` — the exact worked example from the official KoSIT
"Leitweg-ID Format-Spezifikation Version 2.0.2" (§2.4), also used by the root fixture
`fixtures/de-b2g-leitweg-id`. Exercises the Leitweg-ID check: `buildInvoice` validates the declared
Leitweg-ID's shape and its real ISO/IEC 7064 MOD 97-10 check digit (`leitweg-id.ts`) and writes it to
BT-10 — KoSIT itself only checks that BT-10 is present (`BR-DE-15`).
