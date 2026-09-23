# commerce-b2g-leitweg-id

`CommerceInvoiceInput` for a German public-sector (B2G) buyer with a real Leitweg-ID as
`references.buyerReference` — the exact worked example from the official KoSIT
"Leitweg-ID Format-Spezifikation Version 2.0.2" (§2.4), also used by the root fixture
`fixtures/de-b2g-leitweg-id`. Exercises the Leitweg-ID check: `buildInvoice` recognizes the Leitweg-ID
shape and validates its real ISO/IEC 7064 MOD 97-10 check digit (`leitweg-id.ts`), not just BT-10
presence (`BR-DE-15`, which is all KoSIT itself checks).
