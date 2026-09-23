# Test catalog

Back to [`docs/README.md`](README.md). What's actually tested, where, and how to run it — required by `AGENTS.md` §11.
Kept as a catalog of real suites and what each one covers, not a line-by-line test list (that drifts out of
sync with the code the moment either changes; run the suite itself for the exact assertions). Scenarios
that genuinely can't be automated are in [`docs/manual-testing.md`](manual-testing.md) instead.

## Unit tests (vitest, one suite per package)

Run all of them: `pnpm test` (per-package: `pnpm --filter <package> test`).

### `einvoice-model` (20 tests)

- `src/index.test.ts` — `validateModel`: structural validation of an `Invoice` against the generated JSON
  Schema, and that BG-16 without BT-81 does not type-check (BR-49).
- `src/fixtures.test.ts` — every fixture in `fixtures/` (T-050/T-022) validates against that same generated
  schema — the model-level counterpart to the conformance suite's real KoSIT run below.

### `einvoice-commerce` (111 tests)

- `src/build-invoice.test.ts` — `buildInvoice`, organized by `docs/tax-semantics.md` scenario row: domestic
  (row 1), intra-EU supply needing VAT-ID evidence and a delivery to another member state (row 3), export
  decided by where the goods go (row 4), domestic and cross-border reverse charge (rows 5 and 12, the latter
  needing BT-48), shipping/discount rates following the lines' rate, line-level discounts (BG-27), credit
  notes (row 10, T-064), Leitweg-ID validation (T-062), input validation, BT-158/BT-159 customs fields (T-060
  continuation), and defensive behavior against a malformed non-TypeScript caller (ADR-003, T-060).
- `src/tax-rules.test.ts` — `decideVatCategory`, at least one test per `docs/tax-semantics.md` row — the
  actual VAT category decision table, in code form — plus the refusals around it (VIES evidence for another
  VAT-ID, a German buyer VAT-ID for row 3, the exempt/zero-rated overrides outside Germany).
- `src/decimal.test.ts` — exact decimal arithmetic and BR-CO-\* rounding (ties towards +Infinity, ADR-004),
  and `netFromGross` (the net amount whose VAT brings it back to a given gross sum, used for partial credit
  notes).
- `src/leitweg-id.test.ts` — `validateLeitwegId` against the real KoSIT Leitweg-ID Format-Spezifikation
  v2.0.2, plus `looksLikeLeitwegId`.
- `src/numbering.test.ts` — `SequentialNumberer`, and `InMemoryNumberingStore`'s own concurrency behavior
  (T-063 acceptance: no duplicate or skipped numbers under concurrent calls within one process).
- `src/profile.test.ts` — `selectProfile`: the ZUGFeRD/Factur-X profile by recipient geography (T-066),
  including the refusal of clearance-model countries (IT, PL).
- `src/validate.test.ts` — `validateCommerceInvoiceInput` against the generated `CommerceInvoiceInput` JSON
  Schema (T-060).
- `src/vat-id-verifier.test.ts` — `StaticVatIdVerifier` (the three real VIES outcomes: valid, invalid,
  service unavailable — D-19 acceptance) and `MapVatIdVerifier`.

### `einvoice-cii` (18 tests)

- `src/index.test.ts` — `serializeCii`: the serialization plan (`src/generated/plan.ts`, written by hand in
  generated style — there is no generator for it yet) producing the expected CII elements for the
  repository's fixtures, deterministically, and never an empty optional container (no empty
  `URIUniversalCommunication`, BR-62/63; no empty deliver-to address, BR-57). The tests call the
  `en16931-cii` profile only; `serializeCii` does not yet vary its output by profile.

### `einvoice-pdfa` (16 tests)

- `src/index.test.ts` — `buildXmpPacket` (the hand-written XMP packet, both ZUGFeRD/Factur-X profiles) and
  `embedInvoiceInPdfA3` (determinism — two calls on the same input give byte-identical output — that
  the Info dictionary is left untouched, ADR-004, and that the XMP stream is valid UTF-8 with a non-ASCII
  title intact).
- `src/render-invoice.test.ts` — `renderInvoicePdf`: real embedded-font rendering, determinism, every real
  fixture rendering without throwing, and non-ASCII text (umlauts, ß, —, ½, Ø).

### `einvoice-medusa` (155 tests)

- `src/mapping/order-to-commerce-invoice-input.test.ts` — `mapOrderToCommerceInvoiceInput`: every real
  mapping edge case documented in
  [`docs/mapping-reference-medusa.md`](mapping-reference-medusa.md) (buyer name/address fallback chains,
  tax-inclusive price backing-out, B2G buyer reference resolution, `MissingBuyerCountryError`, shipping
  methods as one document-level charge and promotions as line allowances), `describeOrderTotalMismatch`
  (invoice total vs `order.total`) and `issueDateInSellerTimeZone` (the invoice date in Berlin, not UTC).
- `src/tax-matrix/tax-matrix.test.ts` (T-117/T-133, 57 tests) — the tax-scenario fixture matrix: every
  `packages/einvoice-medusa/fixtures/tax-matrix/*` cell driven through the real, unmocked
  `mapOrderToCommerceInvoiceInput` → `buildInvoice`/`selectProfile` (two independent axes, not the
  subscribers' own early-exit chaining — see `src/tax-matrix/types.ts`'s doc comment for why), asserted
  against an `expected.json` written from `docs/tax-semantics.md` before the first run. Fast, no Docker —
  covers every cell's category/error outcome; `pnpm conformance:tax-matrix` (below) covers the remaining
  half, that a cell expected to validate really passes the real KoSIT validator. Full matrix inventory and
  result: [`packages/einvoice-medusa/fixtures/tax-matrix/README.md`](../packages/einvoice-medusa/fixtures/tax-matrix/README.md).
- `src/modules/einvoice/service.test.ts` — `EinvoiceModuleService`'s constructor-time option validation
  (`assertValidOptions`): every field a real KoSIT rejection found mandatory (T-071), seller contact
  included, and that `standalone.basePdf` passes through unchanged (T-073); and `recordDocumentIfAbsent`
  telling a lost idempotency race (the key exists after a failed insert) from a real failure.
- `src/mapping/credit-note.test.ts` — `decideCreditScope` (a refund credits at most what is still
  outstanding on the invoice; the whole order is restated only when nothing was credited before),
  `toPartialCreditNoteInput` (one line over the credited net amount) and `extractGrandTotalFromCii`.
- `src/subscribers/credit-note-on-payment-refunded.test.ts` — the refund subscriber: `extractIssueDateFromCii`
  (parsing BT-2 back out of already-generated CII XML), `MissingOriginalInvoiceError`, a full refund
  restating the order, a partial refund producing a one-line credit note, never crediting beyond what is
  outstanding, and a partial refund over mixed VAT rates refused before a document number is taken.
- `src/subscribers/credit-note-on-order-canceled.test.ts` — the cancellation subscriber: no credit note
  without an invoice, the whole invoice or only its outstanding remainder credited, and Webbers mode
  leaving the credit note to the merchant.
- `src/integrations/webbers.test.ts` — `waitForWebbersInvoice`'s own-package-not-installed path,
  `WebbersInvoiceNotFoundError`, and `fetchWebbersPdfBytes` (both the success and the non-2xx-response
  path, via a stubbed `fetch`).
- `src/storage.test.ts` — `storeEinvoiceFiles` (XML-only vs. XML+PDF upload shape), `deleteEinvoiceFiles`
  (including that a failed delete is swallowed, not thrown), and `fetchFileBytes`.
- `src/subscribers/invoice-on-fulfillment-created.test.ts` and `…split-fulfillments.test.ts` — the invoice
  subscriber's orchestration: idempotency, the order-not-found guard, standalone vs Webbers numbering and
  PDF source, the concurrency-race cleanup, split fulfillments, and that `buildInvoice` warnings and a total
  mismatch are logged without the invoice payload.
- `src/api/einvoice-http.test.ts` — the admin/store routes' shared helpers: `listEinvoiceDocumentSummaries`, `sendEinvoiceFile` and `customerOwnsOrder` (a customer can only reach documents of their own orders).

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

| Level | What                                                                                                                                        | Command                           | Fixtures                                                                                           |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- | -------------------------------------------------------------------------------------------------- |
| L1+L2 | Real KoSIT Validator (XSD + Schematron, incl. `BR-DE-*`)                                                                                    | `pnpm conformance:fixtures`       | 14/14, `fixtures/`                                                                                 |
| L1+L2 | Same, for `CommerceInvoiceInput` → `buildInvoice` → `serializeCii` (not just hand-built `Invoice`s)                                         | `pnpm conformance:commerce`       | 5/5, `packages/einvoice-commerce/fixtures/`                                                        |
| L1+L2 | Same, starting from a synthetic Medusa order through the real adapter (T-117/T-133); 3× per run for determinism                             | `pnpm conformance:tax-matrix`     | 20/20 (cells with a validated build-axis outcome), `packages/einvoice-medusa/fixtures/tax-matrix/` |
| L3    | Real veraPDF `--flavour 3b` + Mustang `validate` (PDF/A-3b, XMP conformance), both ZUGFeRD profiles                                         | `pnpm conformance:pdfa`           | 28/28 (14 fixtures × `XRECHNUNG`, `EN16931`)                                                       |
| L4    | Differential oracle vs. `@e-invoice-eu/core`                                                                                                | `pnpm conformance:oracle-eu`      | 14 (2 byte-identical, 12 classified, 0 unreviewed)                                                 |
| L4    | Differential oracle vs. `@stackforge-eu/factur-x`                                                                                           | `pnpm conformance:oracle-facturx` | 14 (13 classified, 1 unmappable, 0 unreviewed)                                                     |
| L5    | Real Mustang `validate` of each fixture's CII XML (a second, independent validator); totals are printed, not yet compared back to the model | `pnpm conformance:roundtrip`      | 14/14                                                                                              |

`AGENTS.md` §8 governs what each level actually proves and what it's forbidden to claim — none of the above
is ever asserted from memory of a previous run; every task that touches serialization re-runs the relevant
level for real (see `docs/domain-glossary.md` and the private planning log for the specific runs behind
each "Validation successful"/"PASS" claimed in a commit message).

## End-to-end suite (T-078)

Covered in more depth in [`docs/e2e.md`](e2e.md); listed here for the same completeness reason as the
conformance suite above — a different kind of test from either: it proves **wiring** (does a real order's
data reach the plugin, over the real Admin/Store HTTP API, and come back out as a correct, validator-passing
document?), not tax-category correctness (the tax-matrix row above already owns that) or document-format
conformance in isolation (the conformance suite above already owns that). `pnpm e2e`, 9 files / 15 checks:
S1 (domestic B2B, PDF/A-3b), S2 (cross-border with VAT-ID), S4 (return → credit note), S5 (partial refund →
one-line credit note of the refunded amount), S6 (cancellation after the invoice → credit note reversing
it), idempotency (event redelivery), Store API ownership, incomplete-config boot refusal, and tarball
contents across all six published packages.

## CI wiring

`.github/workflows/ci.yml` runs, across six jobs: the full vitest suite, the `node --test` tooling suite,
`pnpm license-scan` (T-003), two codegen-determinism checks (`einvoice-model`, `einvoice-pdfa`'s ICC/font
generation) and two L4-oracle-report-is-up-to-date checks (all four "must give a zero diff on a clean tree"
gates, ADR-002), a Docker smoke test against a vendored KoSIT test document, and the four fixture-based
conformance jobs above (`conformance-fixtures`, `conformance-commerce`, `conformance-tax-matrix`,
`conformance-pdfa`). Every job listed here has
also been run and passed locally, on the same commands CI itself invokes, not merely written and assumed
correct.

`.github/workflows/e2e.yml` (T-078) runs the end-to-end suite above separately — nightly and on
`workflow_dispatch`, not on every push/PR, since a full Docker Compose stand boot is minutes of work per
run and the integration surface it covers changes slowly. Run and passed locally against the same command
(`pnpm e2e`).
