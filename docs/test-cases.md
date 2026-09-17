# Test catalog

Back to [`docs/README.md`](README.md). What's actually tested, where, and how to run it — required by `AGENTS.md` §11.
Kept as a catalog of real suites and what each one covers, not a line-by-line test list (that drifts out of
sync with the code the moment either changes; run the suite itself for the exact assertions). Scenarios
that genuinely can't be automated are in [`docs/manual-testing.md`](manual-testing.md) instead.

## Unit tests (vitest, one suite per package)

Run all of them: `pnpm test` (per-package: `pnpm --filter <package> test`).

### `einvoice-model` (19 tests)

- `src/index.test.ts` — `validateModel`: structural validation of an `Invoice` against the generated JSON
  Schema.
- `src/fixtures.test.ts` — every fixture in `fixtures/` (T-050/T-022) validates against that same generated
  schema — the model-level counterpart to the conformance suite's real KoSIT run below.

### `einvoice-commerce` (69 tests)

- `src/build-invoice.test.ts` — `buildInvoice`, organized by `docs/tax-semantics.md` scenario row: domestic
  (row 1), intra-EU supply needing VAT-ID evidence (row 3), credit notes (row 10, T-064), Leitweg-ID
  validation (T-062), input validation, BT-158/BT-159 customs fields (T-060 continuation), and defensive
  behavior against a malformed non-TypeScript caller (ADR-003, T-060).
- `src/tax-rules.test.ts` — `decideVatCategory`, one test per `docs/tax-semantics.md` row — the actual VAT
  category decision table, in code form.
- `src/decimal.test.ts` — exact decimal arithmetic and BR-CO-\* rounding (ties towards +Infinity, ADR-004).
- `src/leitweg-id.test.ts` — `validateLeitwegId` against the real KoSIT Leitweg-ID Format-Spezifikation
  v2.0.2, plus `looksLikeLeitwegId`.
- `src/numbering.test.ts` — `SequentialNumberer`, and `InMemoryNumberingStore`'s own concurrency behavior
  (T-063 acceptance: gap-free numbering under concurrent calls).
- `src/validate.test.ts` — `validateCommerceInvoiceInput` against the generated `CommerceInvoiceInput` JSON
  Schema (T-060).
- `src/vat-id-verifier.test.ts` — `StaticVatIdVerifier` (the three real VIES outcomes: valid, invalid,
  service unavailable — D-19 acceptance) and `MapVatIdVerifier`.

### `einvoice-cii` (16 tests)

- `src/index.test.ts` — `serializeCii`: the generated serialization plan actually producing byte-correct
  CII XML for both profiles (`en16931-cii`, `xrechnung-3.0-cii`).

### `einvoice-pdfa` (15 tests)

- `src/index.test.ts` — `buildXmpPacket` (the hand-written XMP packet, both ZUGFeRD/Factur-X profiles) and
  `embedInvoiceInPdfA3` (determinism — two calls on the same input give byte-identical output — and that
  the Info dictionary is left untouched, ADR-004).
- `src/render-invoice.test.ts` — `renderInvoicePdf`: real embedded-font rendering, determinism, every real
  fixture rendering without throwing, and non-ASCII text (umlauts, ß, —, ½, Ø).

### `einvoice-medusa` (109 tests)

- `src/mapping/order-to-commerce-invoice-input.test.ts` — `mapOrderToCommerceInvoiceInput`: every real
  mapping edge case documented in
  [`docs/mapping-reference-medusa.md`](mapping-reference-medusa.md) (buyer name/address fallback chains,
  tax-inclusive price backing-out, B2G buyer reference resolution, `MissingBuyerCountryError`).
- `src/tax-matrix/tax-matrix.test.ts` (T-117/T-133, 49 tests) — the tax-scenario fixture matrix: every
  `packages/einvoice-medusa/fixtures/tax-matrix/*` cell driven through the real, unmocked
  `mapOrderToCommerceInvoiceInput` → `buildInvoice`/`selectProfile` (two independent axes, not the
  subscribers' own early-exit chaining — see `src/tax-matrix/types.ts`'s doc comment for why), asserted
  against an `expected.json` written from `docs/tax-semantics.md` before the first run. Fast, no Docker —
  covers every cell's category/error outcome; `pnpm conformance:tax-matrix` (below) covers the remaining
  half, that a cell expected to validate really passes the real KoSIT validator. Full matrix inventory and
  result: [`packages/einvoice-medusa/fixtures/tax-matrix/README.md`](../packages/einvoice-medusa/fixtures/tax-matrix/README.md).
- `src/modules/einvoice/service.test.ts` — `EinvoiceModuleService`'s constructor-time option validation
  (`assertValidOptions`): every field a real KoSIT rejection found mandatory (T-071), and that
  `standalone.basePdf` passes through unchanged (T-073).
- `src/subscribers/credit-note-on-payment-refunded.test.ts` — `extractIssueDateFromCii` (parsing BT-2 back
  out of already-generated CII XML) and `MissingOriginalInvoiceError`.
- `src/integrations/webbers.test.ts` — `waitForWebbersInvoice`'s own-package-not-installed path,
  `WebbersInvoiceNotFoundError`, and `fetchWebbersPdfBytes` (both the success and the non-2xx-response
  path, via a stubbed `fetch`).
- `src/storage.test.ts` — `storeEinvoiceFiles` (XML-only vs. XML+PDF upload shape), `deleteEinvoiceFiles`
  (including that a failed delete is swallowed, not thrown), and `fetchFileBytes`.

### `einvoice-conformance` (8 tests) / `einvoice-ubl` (1 test)

- `einvoice-conformance/src/kosit-report.test.ts` — `parseKositReport`: real KoSIT XML report parsing,
  including the `BR-DE-TMP-32`-is-informational-not-a-failure distinction
  (`docs/domain-glossary.md`). `src/index.test.ts` is a scaffold smoke test.
- `einvoice-ubl/src/index.test.ts` — scaffold smoke test only; UBL serialization itself is v0.2 scope
  (T-080, not yet implemented).

## Tooling tests (`node:test`, not part of any package)

Run together: `node --test tools/codegen/model/*.test.mjs tools/conformance/oracle-e-invoice-eu/*.test.mjs tools/conformance/oracle-stackforge-facturx/*.test.mjs tools/license-scan/*.test.mjs`
(exactly the line `.github/workflows/ci.yml` runs).

- `tools/codegen/model/extract-codelists.test.mjs`, `extract-term-names.test.mjs` — the EN 16931 artifact
  parsers `codegen:model` is built on (T-011).
- `tools/conformance/oracle-e-invoice-eu/canonicalize.test.mjs`, `map-to-ubl.test.mjs` — the L4 differential
  oracle's own XML canonicalization and `Invoice` → `@e-invoice-eu/core` input mapping (T-041).
- `tools/conformance/oracle-stackforge-facturx/map-to-facturx-input.test.mjs` — the second L4 oracle's own
  mapping (T-042).
- `tools/license-scan/license-policy.test.mjs` — the license allow-list logic itself (T-003): SPDX
  expression normalization (plain string, `(X AND Y)`, `(X OR Y)`, the legacy `licenses` array form), and
  that the runtime/dev allow-lists actually reject a real copyleft license and accept the plan's own two
  named dev-only exceptions (`WTFPL`, `EUPL-1.2`).

## Conformance suite (Docker-based, the official validators — not a stub)

Covered in more depth in [`docs/README.md`](README.md#conformance-validators); listed here for
completeness since it's as much a "test suite" as the vitest ones above, just one that needs
`docker compose -f docker/compose.conformance.yml build` first.

| Level | What                                                                                                            | Command                           | Fixtures                                                                                           |
| ----- | --------------------------------------------------------------------------------------------------------------- | --------------------------------- | -------------------------------------------------------------------------------------------------- |
| L1+L2 | Real KoSIT Validator (XSD + Schematron, incl. `BR-DE-*`)                                                        | `pnpm conformance:fixtures`       | 14/14, `fixtures/`                                                                                 |
| L1+L2 | Same, for `CommerceInvoiceInput` → `buildInvoice` → `serializeCii` (not just hand-built `Invoice`s)             | `pnpm conformance:commerce`       | 5/5, `packages/einvoice-commerce/fixtures/`                                                        |
| L1+L2 | Same, starting from a synthetic Medusa order through the real adapter (T-117/T-133); 3× per run for determinism | `pnpm conformance:tax-matrix`     | 17/17 (cells with a validated build-axis outcome), `packages/einvoice-medusa/fixtures/tax-matrix/` |
| L3    | Real veraPDF `--flavour 3b` + Mustang `validate` (PDF/A-3b, XMP conformance)                                    | `pnpm conformance:pdfa`           | 14/14                                                                                              |
| L4    | Differential oracle vs. `@e-invoice-eu/core`                                                                    | `pnpm conformance:oracle-eu`      | 14 (2 byte-identical, 12 classified, 0 unreviewed)                                                 |
| L4    | Differential oracle vs. `@stackforge-eu/factur-x`                                                               | `pnpm conformance:oracle-facturx` | 14 (13 classified, 1 unmappable, 0 unreviewed)                                                     |
| L5    | Real Mustang round-trip (independent re-derivation of totals from line items)                                   | `pnpm conformance:roundtrip`      | 14/14                                                                                              |

`AGENTS.md` §8 governs what each level actually proves and what it's forbidden to claim — none of the above
is ever asserted from memory of a previous run; every task that touches serialization re-runs the relevant
level for real (see `docs/domain-glossary.md` and the private planning log for the specific runs behind
each "Validation successful"/"PASS" claimed in a commit message).

## CI wiring

`.github/workflows/ci.yml` runs, across five jobs: the full vitest suite, the `node --test` tooling suite,
`pnpm license-scan` (T-003), two codegen-determinism checks (`einvoice-model`, `einvoice-pdfa`'s ICC/font
generation) and two L4-oracle-report-is-up-to-date checks (all four "must give a zero diff on a clean tree"
gates, ADR-002), a Docker smoke test against a vendored KoSIT test document, and the four fixture-based
conformance jobs above (`conformance-fixtures`, `conformance-commerce`, `conformance-tax-matrix`,
`conformance-pdfa`). This workflow
has not yet run on GitHub Actions itself — there is no GitHub remote configured for this repository yet
(T-001, still `doing`) — every job listed here has been run and passed locally, on the same commands CI
itself invokes, not merely written and assumed correct.
