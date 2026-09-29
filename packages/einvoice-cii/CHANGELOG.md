# @normwerk/einvoice-cii

## 0.1.0

### Minor Changes

- First release. `serializeCii` writes an `Invoice` as UN/CEFACT CII D16B XML in two profiles — EN 16931
  (the XML of ZUGFeRD / Factur-X) and XRechnung 3.0 — byte-identical for the same input, in an element
  order checked against the official XSD. A field the profile cannot carry is refused
  (`UnmappedInvoiceFieldsError`), never dropped. Every fixture passes the KoSIT Validator and is compared
  with two independent generators.

### Patch Changes

- Updated dependencies
  - @normwerk/einvoice-model@0.1.0
