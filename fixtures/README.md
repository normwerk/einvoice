# Fixtures

Base scenario fixtures (plan-v0.1 §7, T-050). One directory per scenario:

- `input.json` — the scenario in `Invoice` model form (`@normwerk/einvoice-model`), validated against the
  generated JSON Schema by `packages/einvoice-model/src/fixtures.test.ts`.
- `scenario.md` — what the scenario is, which BR-\* rules apply, and the norm source. Cross-references the
  matching row in [`docs/tax-semantics.md`](../docs/tax-semantics.md).
- `expected/` — golden CII XML and PDF/A metadata, added once `einvoice-cii` (T-020) exists. Empty for now.

All identifiers are synthetic (`AGENTS.md` §5.2) — `Musterfirma GmbH`, `DE 123456789` follows the
convention KoSIT's own XRechnung test suite uses.

| Fixture                 | Category | Scenario                                                 |
| ----------------------- | -------- | -------------------------------------------------------- |
| `de-b2b-standard`       | S, 19%   | DE → DE B2B, standard rate                               |
| `de-b2b-reverse-charge` | AE       | DE → DE, construction-sector reverse charge (§13b UStG)  |
| `de-eu-intracommunity`  | K        | DE → FR B2B, buyer VAT-ID given                          |
| `de-export`             | G        | DE → CH (non-EU)                                         |
| `de-exempt`             | E        | DE domestic, exempt supply                               |
| `de-credit-note`        | S, 19%   | Credit note (381) for a full return of `de-b2b-standard` |

Extending this set (mixed rates, line-level discounts, Leitweg-ID, long/special-character text, high
line-count documents) is plan-v0.1 §7's W7 scope, not this pass.
