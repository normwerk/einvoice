# Tax scenario fixture matrix

One cell per row of [`docs/tax-semantics.md`](../../../../docs/tax-semantics.md), plus a few policy
and scope-guard cells. Each cell is a synthetic Medusa order (or refund) driven through the real,
unmocked adapter mapping `mapOrderToCommerceInvoiceInput`
(`../../src/mapping/order-to-commerce-invoice-input.ts`) and then into `buildInvoice` and
`selectProfile` from `@normwerk/einvoice-commerce`.

The other fixture sets in this repository (root `fixtures/`, `packages/einvoice-commerce/fixtures/`)
call `buildInvoice` with a hand-built `CommerceInvoiceInput` and never touch the adapter. This matrix
exists to prove the adapter itself: that a real order shape reaches the VAT category and profile
`docs/tax-semantics.md` says it should, or is refused where that document says it must be.

All identities are synthetic (`Musterfirma GmbH`, test-range VAT-IDs).

## What a cell contains

Each `<cell-id>/` directory holds:

- `order.json` — a `MedusaOrderForInvoice`.
- `map-options.json` — `{ sellerKey, mapOptions }`. `mapOptions` is `MapOrderOptions` without
  `seller`; the seller comes from `_shared/sellers.json` by key (`de` = Musterfirma GmbH, `fr` =
  Exemple SARL).
- `expected.json` — the expected outcome on each axis (see below).
- `scenario.md` — the scenario, its legal source and the applicable BR-\* rules.
- `vat-id-evidence.json` (optional) — a scripted `VatIdVerifier.verify()` result, passed to
  `buildInvoice` as `vatIdEvidence`. It stands in for `EinvoiceModuleOptions.vatIdVerifier`, which
  the real subscribers call before `buildInvoice`. Present on the `row-03-intra-eu-goods` and
  `row-12-eu-b2b-service` cells and their credit-note twins.
- `select-profile-options.json` (optional) — `{ preferredProfile? }` for `selectProfile`. No cell
  uses one today.

A directory without `order.json` is documentation only; `src/tax-matrix/load-cells.ts` skips it.
The only such directory is `row-11-corrected-invoice-384` (see [Open](#open)).

Document numbering is I/O done by the subscribers, and no category rule reads the number, so the
harness sets a deterministic `TEST-<cell id>` instead of running the real numbering stack.

### How `expected.json` is written

Expectations are written from `docs/tax-semantics.md` **before** a cell is first run, never copied
from whatever the adapter happens to return.

- `build` — the mapper → `buildInvoice` outcome: `{ kind: "ok", category }` or
  `{ kind: "error", errorClass, errorCode, messageIncludes? }` — `errorCode` is the error's stable code.
- `profile` — the mapper's B2G signal → `selectProfile` outcome: `{ kind: "ok", profile }` or an
  error in the same shape.
- `specRow` — the `docs/tax-semantics.md` row the cell exercises (absent on policy and scope cells).
- `specCategory` — the single category the spec gives for the scenario.
- `specRequiresRefusal: true` — set instead of `specCategory` when the spec has no single category
  and refusal is the only correct behaviour (row 13).
- `knownBugs` (optional) — marks an axis outcome that is a known defect rather than intended
  behaviour. No cell carries one: every recorded outcome is the intended behaviour.

`build` and `profile` are what the tests assert, and they always record the real adapter output.
The spec fields are kept separately so that any disagreement between the adapter and the spec is
visible in the data, not only in prose. A cell can carry `specCategory` and still expect a build
refusal when a precondition the row requires is missing (VIES evidence for K, a declared rate for
OSS, a declared reverse charge for a cross-border service). The exact contract is the
`CellExpectation` doc comment in `../../src/tax-matrix/types.ts`.

## Why two independent axes

The real subscribers call `selectProfile` first and stop if it throws. If the matrix chained the
two calls the same way, a profile refusal would hide whatever `buildInvoice` does with that order,
and a wrong category on a cross-border cell could stay invisible behind it. So each cell maps the
order once and feeds the same mapped input to both functions independently:

- **build** — mapper output → `buildInvoice` → resolved VAT category or the error thrown;
- **profile** — the mapper's B2G buyer reference and buyer country → `selectProfile` → profile or
  the error thrown.

Neither axis uses a hand-built `CommerceInvoiceInput`. This keeps a profile refusal (an unsupported
buyer country) distinguishable from an unrelated tax refusal on the build axis, which is exactly the
case for row 13, where both axes refuse for different reasons. It also means a change to profile
selection can be checked not to move any build-axis result, and vice versa.

When an outcome that used to be unreachable becomes reachable, re-run the existing cell rather than
writing a new one: each gap on the path to a category tends to hide the next. For category K the
chain was VIES evidence, then the delivery address (BG-13, `BR-IC-11`/`BR-IC-12`), then the buyer
VAT-ID (`BR-IC-02`), each visible only once the one before it was in place. When a scenario has
both a success path and a mandatory rejection, they are separate cells, so each cell asserts one
outcome per axis.

## Running it

- **Fast, no Docker** — `pnpm --filter @normwerk/einvoice-medusa test` runs the whole package suite,
  including `src/tax-matrix/tax-matrix.test.ts`. To run only the matrix, from
  `packages/einvoice-medusa`: `npx vitest run src/tax-matrix`. That file has 67 tests: two per
  runnable cell (build axis, profile axis) plus one check that cells were loaded.
- **Real validator, Docker** — `pnpm conformance:tax-matrix` (`tools/conformance/run-tax-matrix.mjs`).
  It takes every cell whose `expected.build.kind` is `"ok"`, serializes the built invoice with
  `serializeCii` (EN 16931 CII) and validates it with KoSIT. The whole set runs three times in one
  invocation, and a cell passes only if KoSIT reports it valid and the XML and verdicts are
  byte-identical across all three runs. Cells that refuse never reach serialization and are fully
  covered by the fast suite. Preconditions (package builds, the KoSIT image) are listed at the top
  of the script.

Last recorded result (2026-09-23): all 33 runnable cells match their `expected.json` on both axes,
and `pnpm conformance:tax-matrix` passes 22/22 validated cells, three times, deterministically. Run
both commands rather than relying on this snapshot.

KoSIT checks structure and business rules, not whether the chosen category is the right one: a
document with the wrong category can validate cleanly. The build-axis assertion is what checks the
category. A green validator run is necessary, never sufficient; `docs/tax-semantics.md` lists what
the validator does not catch.

## Cell inventory

"Row" is the `docs/tax-semantics.md` row. Each `(+ credit note)` entry has a `-credit-note` twin:
the same scenario issued as a credit note (document type 381, with `correctedInvoice` as the
preceding-invoice reference BT-25). The twins of rows 1, 2 and 9 are recorded against row 10
(credit note for a return); the other twins against their own row, since the category follows the
original supply.

| Cell                                             | Row             | Build axis                           | Profile axis                     | What it shows                                                                              |
| ------------------------------------------------ | --------------- | ------------------------------------ | -------------------------------- | ------------------------------------------------------------------------------------------ |
| `row-01-domestic-standard` (+ credit note)       | 1 (twin: 10)    | ok, S                                | ok, EN16931                      | Domestic B2B sale at 19%                                                                   |
| `row-01-domestic-untaxed-line`                   | 1               | error, `TaxRuleError`                | ok, EN16931                      | Medusa charged 0% on a domestic line: refused, not invoiced at 7% or 19%                   |
| `row-02-domestic-reduced` (+ credit note)        | 2 (twin: 10)    | ok, S                                | ok, EN16931                      | Domestic B2B sale of a book at 7%                                                          |
| `row-03-intra-eu-goods` (+ credit note)          | 3               | ok, K                                | ok, EN16931                      | DE → FR goods with a positive VIES check; delivery (BG-13) mapped from the order address   |
| `row-03-intra-eu-goods-no-vat-id-evidence`       | 3               | error, `TaxRuleError`                | ok, EN16931                      | Same order without VIES evidence: K is refused on an unverified VAT-ID                     |
| `row-04-export-goods` (+ credit note)            | 4               | ok, G                                | ok, EN16931                      | DE → CH goods export                                                                       |
| `row-05-reverse-charge` (+ credit note)          | 5               | ok, AE                               | ok, EN16931                      | Domestic §13b UStG service, `regime_override: { kind: "reverse-charge" }`                  |
| `row-06-exempt` (+ credit note)                  | 6               | ok, E                                | ok, EN16931                      | §4 UStG exempt service, `regime_override: { kind: "exempt", reasonText }`                  |
| `row-07-oss-b2c` (+ credit note)                 | 7               | ok, S                                | ok, EN16931                      | DE → NL B2C distance sale, `ossRegistered: true` and `oss_rate_override: "21"`             |
| `row-07-oss-b2c-no-rate-override`                | 7               | error, `TaxRuleError`                | ok, EN16931                      | OSS-registered, but no declared destination-country rate: refused                          |
| `row-07-oss-b2c-reduced-line`                    | 7               | error, `TaxRuleError`                | ok, EN16931                      | A second line Medusa taxed at the reduced Dutch 9%: refused, not invoiced at 21%           |
| `row-07-oss-b2c-service`                         | 7               | error, `TaxRuleError`                | ok, EN16931                      | An OSS sale of a service: refused, the place of supply cannot be read from the order       |
| `row-08-zero-rated-photovoltaic` (+ credit note) | 8               | ok, Z                                | ok, EN16931                      | §12 Abs. 3 UStG, `regime_override: { kind: "zero-rated" }`                                 |
| `row-09-mixed-rates` (+ credit note)             | 9 (twin: 10)    | ok, S                                | ok, EN16931                      | 19% and 7% lines on one document                                                           |
| `row-11-corrected-invoice-384`                   | 11              | — (no runnable fixture)              | —                                | Document type 384 cannot be expressed (see [Open](#open))                                  |
| `row-12-eu-b2b-service` (+ credit note)          | 12              | error, `TaxRuleError`                | ok, EN16931                      | DE → FR B2B service without a declared override: refused                                   |
| `row-12-eu-b2b-service-override`                 | 12              | ok, AE                               | ok, EN16931                      | Same service with `regime_override: { kind: "reverse-charge-cross-border" }`               |
| `row-13-non-eu-b2b-service` (+ credit note)      | 13              | error, `TaxRuleError`                | error, `UnsupportedCountryError` | DE → US B2B service: category contested, and the buyer country is not supported            |
| `reject-seller-not-de`                           | — (scope guard) | error, `TaxRuleError`                | ok, EN16931                      | A French seller: only German sellers are covered                                           |
| `mixed-basket-domestic`                          | — (policy cell) | ok, S                                | ok, EN16931                      | Goods line + service line, DE → DE: a domestic mixed basket is still one category          |
| `mixed-basket-cross-border`                      | — (policy cell) | error, `MixedSupplyCrossBorderError` | ok, EN16931                      | Goods line + service line, DE → FR: no single category for the document                    |
| `b2g-leitweg-id`                                 | — (policy cell) | ok, S                                | ok, XRECHNUNG                    | A declared Leitweg-ID (`customer.metadata.leitweg_id`) fills BT-10 and routes to XRechnung |
| `b2g-order-reference-not-leitweg-id`             | — (policy cell) | ok, S                                | ok, EN16931                      | A buyer reference shaped like a Leitweg-ID (`2024-01`) stays an ordinary reference         |

That is 34 directories: 33 runnable cells and one documentation-only entry. The 22 cells whose
build axis is `ok` form the validated set for `pnpm conformance:tax-matrix`.

Notes on individual cells:

- **Supply type** is derived per line from `items[].requires_shipping` (`false` = service) and
  aggregated to the whole order (all goods, all services, or mixed). The service cells (rows 5, 6,
  12, 13 and the service line of the mixed baskets) set `requires_shipping: false`. See
  [`docs/mapping-reference-medusa.md`](../../../../docs/mapping-reference-medusa.md) for where each
  declared fact (`regime_override`, `oss_rate_override`, `ossRegistered`, `vat_id`) comes from.
- **Row 5** — the buyer carries a VAT-ID because `BR-AE-02` requires a buyer VAT identifier or legal
  registration identifier; `buildInvoice` refuses AE without one
  (`MissingBuyerIdentifierForReverseChargeError`). The `reverse-charge` override is domestic only; a
  cross-border service uses row 12's separate override.
- **Row 7** — OSS needs two declared facts at two tiers: registration is a merchant setting
  (`EinvoiceModuleOptions.ossRegistered`, passed as `MapOrderOptions.ossRegistered`), and the
  destination-country rate is a per-order fact (`order.metadata.oss_rate_override`). This package
  keeps no table of EU VAT rates, so without a declared rate it refuses. The declared rate is the one
  rate of the whole order: a line Medusa charged at another rate is refused, and so is an OSS sale of
  services.
- **Row 8** — the one cell that can catch an exemption reason added where it must not be: `BR-Z-10`
  forbids BT-120/BT-121 on a zero-rated line, the opposite of E, AE, G and K.
- **Row 10** — `BR-55` does not force a credit note to reference the invoice it corrects.
  `buildInvoice` enforces it itself (`MissingCorrectedInvoiceReferenceError` without
  `correctedInvoice`); that guard is unit-tested in `packages/einvoice-commerce/src/build-invoice.test.ts`,
  not re-proven here.
- **Row 12** — the cell keeps `vat-id-evidence.json` on purpose. The row-12 refusal fires before VIES
  evidence is consulted, so the file shows the refusal is not caused by missing evidence. Without
  a correct supply type, the same evidence would let a service order fall into the goods-only K
  branch; this cell is the guard against that.
- **`mixed-basket-domestic`** — the mixed-supply guard applies only to cross-border orders. This cell
  derives `supplyType: "mixed"` and still resolves S, proving that guard does not reach into
  domestic orders.
- **`b2g-leitweg-id` / `b2g-order-reference-not-leitweg-id`** — a Leitweg-ID is a declared fact, never
  read out of BT-10: an ordinary reference such as `2024-01` has the same shape. The pair shows the
  declared one reaching XRechnung and the look-alike staying an ordinary B2B reference.
- **`reject-seller-not-de`** — the buyer is German on purpose, so the profile axis stays green and the
  cell isolates the seller-side guard.

## Refusals by design

Eleven runnable cells expect a build-axis refusal. None of them is a defect; each is the behaviour
`docs/tax-semantics.md` prescribes when the facts needed to pick a category are missing or the
answer is not settled:

| Cell                                        | Error                         | Why it refuses                                                                                       |
| ------------------------------------------- | ----------------------------- | ---------------------------------------------------------------------------------------------------- |
| `row-03-intra-eu-goods-no-vat-id-evidence`  | `TaxRuleError`                | K needs a positive VIES check or an explicit `intra-eu-confirmed` override                           |
| `row-01-domestic-untaxed-line`              | `TaxRuleError`                | A domestic line is invoiced at the rate it was charged, and 0% is not a German rate for it           |
| `row-07-oss-b2c-no-rate-override`           | `TaxRuleError`                | OSS needs the destination country's rate declared                                                    |
| `row-07-oss-b2c-reduced-line`               | `TaxRuleError`                | A reduced destination rate cannot be declared; only the one declared rate can be invoiced            |
| `row-07-oss-b2c-service`                    | `TaxRuleError`                | A service moves to the consumer's country only under §3a Abs. 5 UStG, which the order does not show  |
| `row-12-eu-b2b-service` (+ credit note)     | `TaxRuleError`                | Category AE, but no official artifact example confirms a validator accepts it; needs a declared fact |
| `row-13-non-eu-b2b-service` (+ credit note) | `TaxRuleError`                | Category contested between AE, O and G; no override exists                                           |
| `mixed-basket-cross-border`                 | `MixedSupplyCrossBorderError` | Goods and services cross-border need two categories; one document carries one                        |
| `reject-seller-not-de`                      | `TaxRuleError`                | Only a German seller is covered                                                                      |

On the profile axis, only row 13 refuses: a US buyer is outside the EU/EEA, not Switzerland or the
UK, and not a clearance-model country, so `selectProfile` throws the generic "not yet supported"
`UnsupportedCountryError`.

## Open

- **Row 11, corrected invoice (document type 384).** `CommerceInvoiceInput.document.kind` accepts only
  `"invoice"` and `"credit-note"`, so a corrected invoice cannot be expressed by the model, the
  mapper or `buildInvoice`. The directory holds only `scenario.md`, to keep the row visible here.
- **Row 12 without a declared fact.** The category is not decided for automatic use while no
  official artifact example exists, so the default is refusal. Only a merchant-declared
  `regime_override: { kind: "reverse-charge-cross-border" }` reaches AE; the engine never infers it.
- **Row 13.** Contested between AE, O and G, with no override, so such an invoice cannot be issued
  through this package until the question is resolved.
- **Cross-border mixed baskets.** One category per document; per-line categories are not supported.
  The `MixedSupplyCrossBorderError` message names the alternatives. Splitting the order into
  separate fulfillments is not one of them: the invoice subscriber maps the whole order on every
  `order.fulfillment_created` event, so two fulfillments produce two full-order invoices
  (`../../src/subscribers/invoice-on-fulfillment-created.split-fulfillments.test.ts`).
- **Profile routes not covered here.** Every cell resolves `EN16931` or the generic unsupported-country
  refusal. The `XRECHNUNG` route (a German buyer with a Leitweg-ID-shaped
  `customer.metadata.buyer_reference`) and the clearance-country refusal (Italy, Poland) have no
  cell; they are unit-tested in `packages/einvoice-commerce/src/profile.test.ts`.

## See also

- [`docs/tax-semantics.md`](../../../../docs/tax-semantics.md) — the rows this matrix exercises.
- [`docs/test-cases.md`](../../../../docs/test-cases.md) — the test catalog.
- [`docs/README.md`](../../../../docs/README.md) — documentation index.
