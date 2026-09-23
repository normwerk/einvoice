# de-b2b-reverse-charge

DE seller → DE B2B buyer, domestic service subject to the construction-sector reverse charge (§13b UStG).
Corresponds to row 5 of [`docs/tax-semantics.md`](../../docs/tax-semantics.md).

- **Category:** AE (Reverse charge), 0%
- **Applicable BR-\*:** BR-AE-01, BR-AE-02, BR-AE-08, BR-AE-09, BR-AE-10 (exemption reason is **mandatory**
  for AE — `VATEX-EU-AE`)
- **Norm source:** UStG §13b
- **What the validator does not catch:** whether this specific service actually qualifies for §13b reverse
  charge is a legal judgment `einvoice-commerce` will need to make from `TaxContext`, not something any
  validator checks (see `docs/tax-semantics.md` for related gaps).
- **Levels:** L1+L2 verified against the real KoSIT validator (`pnpm conformance:fixtures`); L4 and L5 as
  described in [`fixtures/README.md`](../README.md).

`expected/` stays empty: this fixture is checked live against the validators rather than compared to a
committed golden CII XML.
