# Test catalog

Back to [`docs/README.md`](README.md). What's actually tested, where, and how to run it — required by `AGENTS.md` §11.
Kept as a catalog of real suites and what each one covers, not a line-by-line test list (that drifts out of
sync with the code the moment either changes; run the suite itself for the exact assertions). Scenarios
that genuinely can't be automated are in [`docs/manual-testing.md`](manual-testing.md) instead.

## Unit tests (vitest, one suite per package)

Run all of them: `pnpm test` (per-package: `pnpm --filter <package> test`).

### `einvoice-model` (23 tests)

- `src/index.test.ts` — `validateModel`: structural validation of an `Invoice` against the generated JSON
  Schema, and that BG-16 without BT-81 does not type-check (BR-49).
- `src/fixtures.test.ts` — every fixture in `fixtures/` validates against that same generated
  schema — the model-level counterpart to the conformance suite's real KoSIT run below.
- `src/errors.test.ts` — `EinvoiceError`: a stable code and the link to its explanation, anchored in lower
  case with hyphens.

### `einvoice-commerce` (173 tests)

- `src/build-invoice.test.ts` — `buildInvoice`, organized by `docs/tax-semantics.md` scenario row: domestic
  (row 1), intra-EU supply needing VAT-ID evidence and a delivery to another member state (row 3), export
  decided by where the goods go (row 4), domestic and cross-border reverse charge (rows 5 and 12, the latter
  needing BT-48), shipping/discount rates following the lines' rate — split across the rates of a mixed
  basket in proportion to the lines, net or gross, and refused when the lines add up to zero; split by the
  whole order's lines when the document invoices one shipment of it; a paid amount (BT-113) leaving the rest
  due (BT-115), refused above the total — line-level
  discounts (BG-27), credit
  notes (row 10), a declared Leitweg-ID validated and an ordinary buyer reference never read as one, input validation, BT-158/BT-159 customs fields, the parties'
  address lines (a seller without a street refused, a buyer without one warned about above EUR 250), both
  parties' electronic address (refused without one: KoSIT rejects it), prices
  including VAT (each rate group's VAT taken out of its gross total, so the invoice totals the gross amounts;
  both a net and a VAT-inclusive amount, or neither, refused), special VAT territories refused before any
  category is decided (goods placed where they go, a service where its buyer is, Northern Ireland for goods
  only), a credit note following the decision of the invoice it corrects (K although VIES says invalid today,
  19 % although the address moved abroad and OSS was switched on, the document itself still checked, refused
  on an invoice), a domestic invoice on which the shop charged no VAT at all refused as `NO_VAT_CHARGED`
  (every line and the shipping at 0 %, or no rate recorded and none classified; one untaxed line among
  taxed ones, or taxed shipping, keeps the line's own code; a credit note not checked), the rates of the
  supply date (a delivery in the second half of 2020 invoiced at 16 %, an order charged 16 % and delivered in
  2021 refused), a credit note at the rate its invoice stated (16 %, though the shop's tax line and today's
  rates say 19 %; an invoice's line carrying such a rate refused), and defensive behavior against a malformed
  non-TypeScript caller (ADR-003).
- `src/tax-rules.test.ts` — `decideVatCategory`, at least one test per `docs/tax-semantics.md` row — the
  actual VAT category decision table, in code form — plus the refusals around it (VIES evidence for another
  VAT-ID, a German buyer VAT-ID for row 3, the exempt/zero-rated overrides outside Germany, OSS for services,
  at a rate of zero or with a reduced line) and `resolveLineRate` never invoicing a line at a rate other
  than the one it was charged at, at the rates of its supply date — a line charged at another period's rate,
  or supplied before the table starts, refused with its own code; each refusal names its own code, linked to
  its explanation.
- `src/de-vat-rates.test.ts` — Germany's rates by period: 16 % and 5 % from 2020-07-01 to 2020-12-31 and
  19 % and 7 % either side, nothing before 2007-01-01, every day covered exactly once, and a quoted norm and
  BGBl reference for both rates of every period.
- `src/supported-jurisdictions.test.ts` — what the release supports: a seller in Germany; buyers in
  Germany, the EU/EEA, Switzerland and the UK served with EN 16931; Italy and Poland refused as clearance
  countries; the one-line statement of it, with nothing planned in it; special VAT territories recognised
  by their member state's code and postcode, and the rest of each member state — Monaco's French postcode
  included — left alone.
- `src/decimal.test.ts` — exact decimal arithmetic and BR-CO-\* rounding (ties towards +Infinity, ADR-004),
  and the arithmetic for prices including VAT: the VAT contained in a gross amount, a group's net spread
  over its parts to the cent (largest remainder), a net unit price from a line amount, comparing rates
  of any scale, and `apportionAmount` (a total split in proportion to weights, to the cent).
- `src/credit-allocation.test.ts` — `allocateCreditAcrossRates`: a received return paid for first at its
  own rate, returns covered in the order received and never beyond a rate's uncredited amount, the rest
  split in proportion to what is uncredited per rate, a cancellation's remainder exactly per rate, and a
  credit above the uncredited amount refused.
- `src/leitweg-id.test.ts` — `validateLeitwegId` against the real KoSIT Leitweg-ID Format-Spezifikation
  v2.0.2.
- `src/numbering.test.ts` — `SequentialNumberer`, and `InMemoryNumberingStore`'s own concurrency behavior
  (no duplicate or skipped numbers under concurrent calls within one process).
- `src/profile.test.ts` — `selectProfile`: the ZUGFeRD/Factur-X profile by recipient geography,
  including the refusal of clearance-model countries (IT, PL) with its own code, and XRechnung only for a
  declared Leitweg-ID.
- `src/validate.test.ts` — `validateCommerceInvoiceInput` against the generated `CommerceInvoiceInput` JSON
  Schema.
- `src/vat-id-verifier.test.ts` — `StaticVatIdVerifier` (the three real VIES outcomes: valid, invalid,
  service unavailable) and `MapVatIdVerifier`.

### `einvoice-cii` (21 tests)

- `src/index.test.ts` — `serializeCii`: the serialization plan (`src/generated/plan.ts`, written by hand in
  generated style — there is no generator for it yet) producing the expected CII elements for the
  repository's fixtures, deterministically, and never an empty optional container (no empty
  `URIUniversalCommunication`, BR-62/63; no empty deliver-to address, BR-57), with each address's lines
  between post code and city; and refusing, instead of silently dropping or emitting unparseable XML, a model
  field the plan has no place for (`UnmappedInvoiceFieldsError`) and a C0 control character
  (`UnrepresentableCharacterError`). The tests call the
  `en16931-cii` profile only; `serializeCii` does not yet vary its output by profile.

### `einvoice-pdfa` (21 tests)

- `src/index.test.ts` — `buildXmpPacket` (the hand-written XMP packet, both ZUGFeRD/Factur-X profiles) and
  `embedInvoiceInPdfA3` (determinism — two calls on the same input give byte-identical output — that
  the Info dictionary is left untouched, ADR-004, and that the XMP stream is valid UTF-8 with a non-ASCII
  title intact).
- `src/render-invoice.test.ts` — `renderInvoicePdf`: real embedded-font rendering, determinism, every real
  fixture rendering without throwing, non-ASCII text (umlauts, ß, —, ½, Ø), each party's address
  lines above post code and city, and the title by document type — "Rechnung / Invoice", "Rechnungskorrektur
  / Credit note" (never "Gutschrift") and "Rechnungskorrektur (berichtigt) / Corrected invoice", a
  correction naming the invoice it corrects, and a type without a title refused.

### `einvoice-medusa` (275 tests)

- `src/mapping/order-to-commerce-invoice-input.test.ts` — `mapOrderToCommerceInvoiceInput`: every real
  mapping edge case documented in
  [`docs/mapping-reference-medusa.md`](mapping-reference-medusa.md) (buyer name/address fallback chains —
  a guest buyer named from the billing address, not the email —
  tax-inclusive prices, discounts and shipping passed on VAT-inclusive, the rate Medusa charged passed on
  as it is — on shipping the highest over its methods, B2G buyer reference resolution, `MissingBuyerCountryError`, shipping
  methods as one document-level charge and promotions as line allowances; one fulfillment's lines, units and
  discount shares, its date as BT-72, the shipping only on the invoice that carries it, split by the whole
  order's rates), `orderPaidInFull` (captured less refunded against the order's total) and
  `issueDateInSellerTimeZone`
  (the invoice date in Berlin, not UTC).
- `src/mapping/charged-reconciliation.test.ts` — `reconcileWithCharged`, the invoice against what Medusa
  charged: agreement within rounding issues; with net prices, less VAT that explains the whole difference
  issues with a refund-due notice; with gross prices and equal totals, a VAT difference either way issues
  with a notice and nothing to refund (Medusa's VAT below the invoice's included); shipping split across
  rates named as the cause, in either direction; credit lines added back to `order.total`; more VAT than
  charged, other total differences, mixed net and gross prices and missing totals block; the explanation
  names the amounts and which way Medusa's VAT differs; `chargedForShipment` — one fulfillment's units at
  Medusa's per-unit amounts and the shipping it carries, the same after a return, nothing when every unit
  came back.
- `src/tax-matrix/tax-matrix.test.ts` (75 tests) — the tax-scenario fixture matrix: every
  `packages/einvoice-medusa/fixtures/tax-matrix/*` cell driven through the real, unmocked
  `mapOrderToCommerceInvoiceInput` → `buildInvoice`/`selectProfile` (two independent axes, not the
  subscribers' own early-exit chaining — see `src/tax-matrix/types.ts`'s doc comment for why), asserted
  against an `expected.json` written from `docs/tax-semantics.md` before the first run. Fast, no Docker —
  covers every cell's category/error outcome, a refusal by its class and its code; `pnpm conformance:tax-matrix` (below) covers the remaining
  half, that a cell expected to validate really passes the real KoSIT validator. Full matrix inventory and
  result: [`packages/einvoice-medusa/fixtures/tax-matrix/README.md`](../packages/einvoice-medusa/fixtures/tax-matrix/README.md).
- `src/medusa-version.test.ts` — the supported Medusa releases: which versions are in and out, that every
  `@medusajs/*` peer dependency declares exactly that range, that another release is refused at start
  with a pointer to a pull request or to hello@normwerk.dev, and that the installed version is read from
  the app root.
- `src/modules/einvoice/service.test.ts` — `EinvoiceModuleService`'s constructor-time option validation
  (`assertValidOptions`): every field a real KoSIT rejection found mandatory, seller contact
  and street included, and that `standalone.basePdf` passes through unchanged; an `integration` option
  refused, and a warning at startup when another invoice plugin is registered; `recordDocumentIfAbsent`
  telling a lost idempotency race (the key exists after a failed insert) from a real failure; and refusals
  — one row per key, updated by a retry refused again and by a lost insert race, cleared once issued.
- `src/modules/einvoice/other-invoice-plugins.test.ts` — `otherInvoicePlugins`: a known invoice plugin
  found under `plugins` (by name or with options) or as a module Medusa merged from it, named once, and
  nothing without one.
- `src/mapping/credit-note.test.ts` — `decideCreditScope` (a refund credits at most what is still
  outstanding on the invoice; the whole order is restated only when nothing was credited before),
  `toPartialCreditNoteInput` (VAT-inclusive lines over the credited sums, at the invoice's rate),
  `extractDeliveryDateFromCii` (BT-72, the day of the supply a credit note corrects), `extractGrandTotalFromCii`,
  `extractGrossByRateFromCii` (a document's gross per rate from its BG-23 breakdown), `returnsToCredit`
  (received returns valued at what the invoice stated for their lines, oldest first, less what earlier
  credit notes paid), `invoicedLineValues` (each order line as the invoice stated it, with its discount
  share), `chooseRefundInvoice` (the one invoice a refund can be tied to: the only one open with everything
  shipped, or the one holding every returned good; otherwise none), `returnedItemIdsToCredit`,
  and `creditableRefund` (after an overpayment notice, a refund returns the overpayment first and credits
  only what goes beyond it).
- `src/subscribers/credit-note-on-payment-refunded.test.ts` — the refund subscriber: `extractIssueDateFromCii`
  (parsing BT-2 back out of already-generated CII XML), `MissingOriginalInvoiceError`, a full refund
  restating the order, a partial refund producing a one-line credit note, never crediting beyond what is
  outstanding, a partial refund over mixed VAT rates credited with a line per rate in proportion to the
  invoice, a received return paid for first at its own rate and recorded as covered, a refund with no
  invoice recorded as a refusal naming its payment, a refund of an overpayment
  the invoice's notice names crediting nothing while a later one credits its own amount, and with two
  invoices a refund credited on the one holding the returned goods, or refused when it names none; the
  decision and VIES answer stored with the invoice followed without a second VIES check, and an invoice
  without a stored decision decided again; an invoice issued at 16 % credited at 16 % and dated by its supply,
  in full and in part, though the order's tax lines say 19 %.
- `src/subscribers/credit-note-on-fulfillment-canceled.test.ts` — a cancelled fulfillment's invoice restated
  with its own lines, a fulfillment never invoiced leaving nothing to credit and its refusal dropped, and the
  credit note issued once however often the event comes.
- `src/events.test.ts` — the event payloads (schema version 1, ids, number and codes) and an event the bus
  could not take logged without failing the document already written; the subscriber, refusal and
  credit-note tests check that an issued document and a refusal are announced, and that a redelivery that
  finds its document announces nothing.
- `src/mapping/shipment.test.ts` — `shipmentLines`: a fulfillment's units with their share of the line
  discount, the shipment that completes a line taking what is left to the cent, a tax-inclusive discount,
  Medusa's discount scaled back to the ordered quantity after a return, a set's units taken from the order's
  record of the fulfillment rather than from its parts (a table and four chairs is one set), a shipped line
  without that record refused, and a line the order does not have refused.
- `src/subscribers/credit-note-on-order-canceled.test.ts` — the cancellation subscriber: no credit note
  without an invoice, the whole invoice or only its outstanding remainder credited, per invoice, an invoice
  of a cancelled fulfillment left to that cancellation, and the order's refused invoices dropped.
- `src/storage.test.ts` — `storeEinvoiceFiles` (XML-only vs. XML+PDF upload shape), `deleteEinvoiceFiles`
  (including that a failed delete is swallowed, not thrown), and `fetchFileBytes`.
- `src/subscribers/invoice-on-fulfillment-created.test.ts` and `…split-fulfillments.test.ts` — the invoice
  subscriber's orchestration: idempotency, the order-not-found guard, numbering and the merchant's own PDF,
  the concurrency-race cleanup, two fulfillments invoiced for their own lines (the first with the shipping,
  each dated the day it shipped, through the real core), an order paid in full stated as paid, a cancelled
  fulfillment not invoiced, a missing one refused, `buildInvoice` warnings logged without the
  invoice payload, an invoice stating more VAT than Medusa charged recorded as a refusal without taking a
  number, one stating less issued with its notice, a `buildInvoice` refusal recorded as a refusal — code, message and rule — instead of thrown, and the VIES answer an intra-EU invoice rests on kept with the document together with its rule, and carried by no event.
- `src/mapping/tax-evidence.test.ts` — `taxEvidenceToKeep`: a document of category K keeps the VIES answer
  it rests on, even "unavailable" when the number was confirmed another way; any other document keeps its
  decision and no VIES answer.
- `src/refusals.test.ts` — `describeRefusal` (a refusal explained by its error's message, a block by its
  amounts) and `recordRefusalOfError` (the error's code, its message, class, rule and the credit note's
  trigger recorded and logged; an unsupported buyer country kept for the support request; an error without a
  code recorded as `INTERNAL_ERROR`).
- `src/errors.test.ts` — the plugin's own errors: a code and its link built exactly as the core packages
  build them, a core package's code read back and anything else called `INTERNAL_ERROR`, and a support
  request filled in with the country only.
- `src/api/einvoice-http.test.ts` — the admin/store routes' shared helpers: `listEinvoiceDocumentSummaries`, `sendEinvoiceFile` and `customerOwnsOrder` (a customer can only reach documents of their own orders), and `listAdminEinvoiceStatus` (notices and refusals with their retry route and the link to their code's
  explanation, a support request for an unsupported buyer country, each document's rule and the VIES answer
  of an intra-EU supply, admin only — the store listing carries no notice), and `einvoiceSupportStatus` (what the release supports and the configured seller country).
- `src/api/admin/orders/[id]/einvoice/refusals/[refusalId]/retry/route.test.ts` — the retry route: 404 for
  another order's refusal, the invoice issued, a retry still blocked saying why, 500 for a failure after
  the checks, and a credit note retried by redelivering its refund or cancellation — issued, refused again,
  or nothing left to credit.

### `einvoice-conformance` (8 tests) / `einvoice-ubl` (1 test)

- `einvoice-conformance/src/kosit-report.test.ts` — `parseKositReport`: real KoSIT XML report parsing,
  including the `BR-DE-TMP-32`-is-informational-not-a-failure distinction
  (`docs/domain-glossary.md`). `src/index.test.ts` is a scaffold smoke test.
- `einvoice-ubl/src/index.test.ts` — scaffold smoke test only; UBL serialization itself is v0.2 scope,
  not yet implemented.

## Tooling tests (`node:test`, not part of any package)

Run together: `node --test tools/codegen/model/*.test.mjs tools/conformance/oracle-e-invoice-eu/*.test.mjs tools/conformance/oracle-stackforge-facturx/*.test.mjs tools/conformance/roundtrip-mustang/*.test.mjs tools/license-scan/*.test.mjs tools/rates/*.test.mjs`
(exactly the line `.github/workflows/ci.yml` runs).

- `tools/codegen/model/extract-codelists.test.mjs`, `extract-term-names.test.mjs` — the EN 16931 artifact
  parsers `codegen:model` is built on.
- `tools/conformance/oracle-e-invoice-eu/canonicalize.test.mjs`, `map-to-ubl.test.mjs` — the L4 differential
  oracle's own XML canonicalization and `Invoice` → `@e-invoice-eu/core` input mapping.
- `tools/conformance/oracle-stackforge-facturx/map-to-facturx-input.test.mjs` — the second L4 oracle's own
  mapping.
- `tools/conformance/roundtrip-mustang/compare-ubl.test.mjs` — L5's comparison of what Mustang read out of
  our XML with the model: normalised amounts and decoded text match, a different total or a missing line
  does not.
- `tools/license-scan/license-policy.test.mjs` — the license allow-list logic itself: SPDX
  expression normalization (plain string, `(X AND Y)`, `(X OR Y)`, the legacy `licenses` array form), and
  that the runtime/dev allow-lists actually reject a real copyleft license and accept the two dev-only
  exceptions named in `AGENTS.md` §5.1 (`WTFPL`, `EUPL-1.2`).
- `tools/rates/ustg.test.mjs`, `watch-ustg.test.mjs` — reading § 12 and § 28 out of the UStG XML, the rate
  table's quotes checked against them (a changed rate, a quote without its rate or a temporary rate without
  its days fails), and the weekly watcher on a synthetic XML: unchanged, one line and no call to GitHub; § 12
  changed, an issue naming it with the quotes that no longer hold and the new text (a stand-in `gh`).

## Conformance suite (Docker-based, the official validators — not a stub)

Covered in more depth in [`docs/README.md`](README.md#conformance-validators); listed here for
completeness since it's as much a "test suite" as the vitest ones above, just one that needs
`docker compose -f docker/compose.conformance.yml build` first.

| Level | What                                                                                                                                                                                                                                                                                       | Command                           | Fixtures                                                                                           |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------- | -------------------------------------------------------------------------------------------------- |
| L1+L2 | Real KoSIT Validator (XSD + Schematron, incl. `BR-DE-*`)                                                                                                                                                                                                                                   | `pnpm conformance:fixtures`       | 14/14, `fixtures/`                                                                                 |
| L1+L2 | Same, for `CommerceInvoiceInput` → `buildInvoice` → `serializeCii` (not just hand-built `Invoice`s)                                                                                                                                                                                        | `pnpm conformance:commerce`       | 8/8, `packages/einvoice-commerce/fixtures/`                                                        |
| L1+L2 | Same, starting from a synthetic Medusa order through the real adapter; 3× per run for determinism                                                                                                                                                                                          | `pnpm conformance:tax-matrix`     | 22/22 (cells with a validated build-axis outcome), `packages/einvoice-medusa/fixtures/tax-matrix/` |
| L3    | Real veraPDF `--flavour 3b` + Mustang `validate` (PDF/A-3b, XMP conformance), both ZUGFeRD profiles                                                                                                                                                                                        | `pnpm conformance:pdfa`           | 28/28 (14 fixtures × `XRECHNUNG`, `EN16931`)                                                       |
| L4    | Differential oracle vs. `@e-invoice-eu/core`                                                                                                                                                                                                                                               | `pnpm conformance:oracle-eu`      | 14 (2 byte-identical, 12 classified, 0 unreviewed)                                                 |
| L4    | Differential oracle vs. `@stackforge-eu/factur-x`                                                                                                                                                                                                                                          | `pnpm conformance:oracle-facturx` | 14 (13 classified, 1 unmappable, 0 unreviewed)                                                     |
| L5    | Mustang (a second, independent implementation) validates each fixture's CII XML with its arithmetic check, then parses it into its own model and writes it out as UBL; the totals, VAT breakdown and each line's quantity and net amount in that UBL are compared with the fixture's model | `pnpm conformance:roundtrip`      | 14/14                                                                                              |

`AGENTS.md` §8 governs what each level actually proves and what it's forbidden to claim — none of the above
is ever asserted from memory of a previous run; every task that touches serialization re-runs the relevant
level for real (see `docs/domain-glossary.md` and the commit history for the specific runs behind each
"Validation successful"/"PASS" claimed in a commit message).

## End-to-end suite

Covered in more depth in [`docs/e2e.md`](e2e.md); listed here for the same completeness reason as the
conformance suite above — a different kind of test from either: it proves **wiring** (does a real order's
data reach the plugin, over the real Admin/Store HTTP API, and come back out as a correct, validator-passing
document?), not tax-category correctness (the tax-matrix row above already owns that) or document-format
conformance in isolation (the conformance suite above already owns that). `pnpm e2e`, 24 files / 37 checks:
S1 (domestic B2B, PDF/A-3b), S2 (cross-border with VAT-ID; the VIES answer kept with the invoice), S4 (return → credit note), S5 (partial refund →
one-line credit note of the refunded amount), S6 (cancellation after the invoice → credit note reversing
it), S7 (promotion code → line allowance), S8 (services-only order to an EU business → category AE), S9
(private guest buyer), S10 (prices including VAT, with and without a promotion), S11 (public-sector buyer:
the declared Leitweg-ID in BT-10 and the XRechnung profile), S12 (VAT charged that a K invoice does not
state: issued with a refund-due notice; refunding the overpayment credits nothing, a further refund
credits its own amount), S13 (an invoice stating more VAT than was charged: not issued, the reason in the
admin API, the order corrected, the retry issues it; a refund made meanwhile refused and credited by its own
retry), S14 (VIES unavailable: the invoice refused and recorded, retried after the VAT-ID was confirmed by
hand, the invoice keeping VIES's "unavailable"; with the confirmation withdrawn, a refund still credited as
K, following the invoice's decision), S15 (a 7 % / 19 % basket: shipping split into a charge per rate with the notice naming it as the
cause; a received return credited at its own rate, a goodwill refund and the rest of a cancelled order
credited per rate, every document KoSIT-green), S16 (prices including VAT, shipping without VAT in Medusa:
the invoice takes 19% out of what was paid and is issued with a notice that Medusa counts less VAT),
S17 (a buyer in Italy: the order ships, the invoice is refused with `UNSUPPORTED_BUYER_COUNTRY_CLEARANCE`,
the link to its explanation and a support request; the store page's support statement), S18 (an order
shipped in two parts, paid in full: two invoices, each for its own line and dated the day it shipped, the
first with the shipping, both stating the payment and nothing due, together the order's total; a return
from the second parcel credited on the second invoice; a cancelled fulfillment's invoice credited in full
and the replacement shipment invoiced without shipping; money back with no goods while a unit is unshipped
refused with `REFUND_NEEDS_MANUAL_CREDIT`), S19 (the plugin's events as a shop's own subscriber in the stand
app receives them: `einvoice.document_issued` for an invoice — ids, number and fulfillment only — and for a
refund's credit note, `einvoice.issuance_blocked` for a blocked invoice with its refusal's id and code; the
document read with the order through the read-only link; a redelivery inside the app announcing nothing a
second time), S20 (a shop that charged no VAT — its German tax region at 0 %, or none at all: the invoice
refused with `NO_VAT_CHARGED` naming §19 UStG and §34a UStDV, the refusal and `einvoice.issuance_blocked`
visible, and no number taken — ordinary orders before and after get consecutive numbers), S21 (a set of two
inventory items, a table and four chairs: invoiced as one set at the order's total, KoSIT-green),
idempotency (an event
delivered to the
subscriber a second time, awaited), Store API ownership, boot refusal (a missing required option; a seller
outside Germany),
and tarball contents across all six published packages. Every invoice scenario also checks that the
invoice totals what Medusa charged (`order.total`) — the stand's German tax region charges 19%, its
Spanish one 21%.

## CI wiring

`.github/workflows/ci.yml` runs, across six jobs: the full vitest suite, the `node --test` tooling suite,
`pnpm license-scan`, two codegen-determinism checks (`einvoice-model`, `einvoice-pdfa`'s ICC/font
generation) and two L4-oracle-report-is-up-to-date checks (all four "must give a zero diff on a clean tree"
gates, ADR-002), a Docker smoke test against a vendored KoSIT test document, and the four fixture-based
conformance jobs above (`conformance-fixtures`, `conformance-commerce`, `conformance-tax-matrix`,
`conformance-pdfa`). Every job listed here has
also been run and passed locally, on the same commands CI itself invokes, not merely written and assumed
correct.

`.github/workflows/e2e.yml` runs the end-to-end suite above separately — nightly and on
`workflow_dispatch`, not on every push/PR, since a full Docker Compose stand boot is minutes of work per
run and the integration surface it covers changes slowly. Run and passed locally against the same command
(`pnpm e2e`).
