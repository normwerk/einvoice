# de-export

DE seller → CH buyer (non-EU), goods exported outside the EU. Corresponds to row 4 of
[`docs/tax-semantics.md`](../../docs/tax-semantics.md).

- **Category:** G (Export outside the EU), 0%
- **Applicable BR-\*:** BR-G-01, BR-G-08, BR-G-09, BR-G-10 (exemption reason mandatory — `VATEX-EU-G`)
- **Norm source:** UStG §4 Nr. 1a + §6 (export supply)
- **Levels:** L1+L2 verified against the real KoSIT validator (`pnpm conformance:fixtures`); L4 and L5 as
  described in [`fixtures/README.md`](../README.md).

`expected/` stays empty: this fixture is checked live against the validators rather than compared to a
committed golden CII XML.
