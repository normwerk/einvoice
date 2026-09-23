# de-b2b-standard

DE seller → DE B2B buyer, domestic supply, standard VAT rate. The baseline scenario — every other fixture
is a variation on this one. Corresponds to row 1 of [`docs/tax-semantics.md`](../../docs/tax-semantics.md).

- **Category:** S (Standard rated), 19%
- **Applicable BR-\*:** BR-S-01, BR-S-02, BR-S-08, BR-S-09
- **Norm source:** UStG §12 Abs. 1
- **Levels:** L1+L2 verified against the real KoSIT validator (`pnpm conformance:fixtures`); L4 and L5 as
  described in [`fixtures/README.md`](../README.md).

`expected/` stays empty: this fixture is checked live against the validators rather than compared to a
committed golden CII XML.
