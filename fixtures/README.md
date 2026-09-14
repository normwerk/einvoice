# Fixtures

Scenario fixtures (plan-v0.1 §7). One directory per scenario:

- `input.json` — the scenario in `Invoice` model form (`@normwerk/einvoice-model`), validated against the
  generated JSON Schema by `packages/einvoice-model/src/fixtures.test.ts`.
- `scenario.md` — what the scenario is, which BR-\* rules apply, and the norm source. Cross-references the
  matching row in [`docs/tax-semantics.md`](../docs/tax-semantics.md) where one exists.
- `expected/` — golden CII XML and PDF/A metadata. Still empty: all 14 fixtures are verified live against
  the real KoSIT validator (`pnpm conformance:fixtures`, T-021/T-022) rather than compared to a committed
  golden file — L4/L5 verification instead runs live against independent implementations: Mustang for L5
  round-trip (`pnpm conformance:roundtrip`, T-043) and two independent generators for the L4 differential
  oracles — `@e-invoice-eu/core` (`pnpm conformance:oracle-eu`, T-041 —
  [`docs/l4-oracle-eu-report.md`](../docs/l4-oracle-eu-report.md)) and `@stackforge-eu/factur-x`
  (`pnpm conformance:oracle-facturx`, T-042 —
  [`docs/l4-oracle-facturx-report.md`](../docs/l4-oracle-facturx-report.md)).

All identifiers are synthetic (`AGENTS.md` §5.2) — `Musterfirma GmbH`, `DE 123456789` follows the
convention KoSIT's own XRechnung test suite uses.

**Base set (T-050):**

| Fixture                 | Category | Scenario                                                 |
| ----------------------- | -------- | -------------------------------------------------------- |
| `de-b2b-standard`       | S, 19%   | DE → DE B2B, standard rate                               |
| `de-b2b-reverse-charge` | AE       | DE → DE, construction-sector reverse charge (§13b UStG)  |
| `de-eu-intracommunity`  | K        | DE → FR B2B, buyer VAT-ID given                          |
| `de-export`             | G        | DE → CH (non-EU)                                         |
| `de-exempt`             | E        | DE domestic, exempt supply                               |
| `de-credit-note`        | S, 19%   | Credit note (381) for a full return of `de-b2b-standard` |

**Extended set (T-022/W7, plan-v0.1 §7):**

| Fixture                | Scenario                                                                         |
| ---------------------- | -------------------------------------------------------------------------------- |
| `de-mixed-rates`       | Standard (19%) and reduced (7%) rates on one invoice                             |
| `de-line-discount`     | Line-level allowance (BG-27)                                                     |
| `de-document-discount` | Document-level allowance (BG-20), with `baseAmount`+`calculationPercent` (T-027) |
| `de-shipping-charge`   | Document-level charge (BG-21), shipping cost                                     |
| `de-special-chars`     | XML-escaping stress test (`&`, `<`, `>`, `"`, non-ASCII)                         |
| `de-many-lines`        | 25 invoice lines — cardinality stress test                                       |
| `de-b2g-leitweg-id`    | Public-sector buyer, real Leitweg-ID-shaped `buyerReference`                     |

**T-093 (found by the L4 oracle, T-041):**

| Fixture                    | Scenario                                                                                           |
| -------------------------- | -------------------------------------------------------------------------------------------------- |
| `de-fiscal-representative` | CH seller with no direct EU VAT-ID, represented by a DE fiscal representative (BG-11, BT-62/63/69) |

All 14 pass the real KoSIT validator (L1 XSD + L2 Schematron, `pnpm conformance:fixtures`) and the real
Mustang validator's arithmetic recalculation (L5, `pnpm conformance:roundtrip`) — a full run of either
takes well under a minute. Against `@e-invoice-eu/core` (L4, T-041): 2/14 (`de-eu-intracommunity`,
`de-export`) produce CII that's byte-for-byte-equivalent (after canonicalization); the other 12 differ, but
every difference reduces to one of two already-investigated, verified causes (a real bug in that generator,
confirmed by running its own output through the real KoSIT validator) — see
[`docs/l4-oracle-eu-report.md`](../docs/l4-oracle-eu-report.md). Against `@stackforge-eu/factur-x`
(L4, T-042): 0/14 are byte-identical, but all 13 comparable fixtures' differences reduce to two verified
causes (a real empty-element bug in that library, and a permissible difference in how each side defaults an
unset delivery date), and 1 (`de-line-discount`) can't be compared at all — its input type has no field for
line-level allowances — see
[`docs/l4-oracle-facturx-report.md`](../docs/l4-oracle-facturx-report.md).

All 14, embedded into a PDF/A-3b ZUGFeRD/Factur-X document (`@normwerk/einvoice-pdfa`, T-030), pass the
real veraPDF PDF/A-3b validator and Mustang's own validate + byte-for-byte extract
(`pnpm conformance:pdfa`) — see [`docs/pdfa.md`](../docs/pdfa.md).
