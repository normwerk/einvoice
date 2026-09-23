# de-exempt

DE domestic exempt supply (medical treatment, §4 Nr. 14 UStG). Corresponds to row 6 of
[`docs/tax-semantics.md`](../../docs/tax-semantics.md).

- **Category:** E (Exempt from VAT), 0%
- **Applicable BR-\*:** BR-E-01, BR-E-08, BR-E-09, BR-E-10 (needs `exemptionReasonText` or
  `exemptionReasonCode` — this fixture uses free text only)
- **Norm source:** UStG §4 (exemption number varies by case)
- **Why no `exemptionReasonCode`:** unlike K/AE/G, category E has no single universal `VATEX-*` code —
  which specific UStG §4 exemption applies is a case-by-case legal judgment (see
  `docs/tax-semantics.md`'s "what the validator does not catch" section).
- **Levels:** L1+L2 verified against the real KoSIT validator (`pnpm conformance:fixtures`); L4 and L5 as
  described in [`fixtures/README.md`](../README.md).

`expected/` stays empty: this fixture is checked live against the validators rather than compared to a
committed golden CII XML.
