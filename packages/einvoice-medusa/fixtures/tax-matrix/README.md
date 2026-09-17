# Tax scenario fixture matrix (T-117)

Every fixture here starts at a synthetic Medusa order/refund and goes through the real, unmocked
`mapOrderToCommerceInvoiceInput` (`../../src/mapping/order-to-commerce-invoice-input.ts`) — unlike every
other fixture in this repo (root `fixtures/`, `packages/einvoice-commerce/fixtures/`), which calls
`buildInvoice` directly and never touches the adapter layer at all. That blindness is what let 58 green
tests coexist with four broken scenarios and one fatal conformance bug (P-12/P-13/P-14/P-16/P-19) — this
matrix exists to make the adapter itself provable, one cell per `docs/tax-semantics.md` row.

## Format

Each `<id>/` directory:

- `order.json` — a `MedusaOrderForInvoice`.
- `map-options.json` — `{ sellerKey, mapOptions }`; `mapOptions` is `MapOrderOptions` minus `seller`
  (`_shared/sellers.json`, keyed `de`/`fr`, so 20+ cells don't repeat the same seller object).
- `select-profile-options.json` (optional) — `{ preferredProfile? }`.
- `expected.json` — written from `docs/tax-semantics.md` / `researches/08-vat-rules-de.md` (+ its two
  addenda, cross-referenced only via the P-23 correspondence table — the two addenda number questions
  differently) **before** the first run, never inferred from current adapter behaviour. `build`/`profile`
  are asserted verbatim against the real, current adapter output — they never encode a hoped-for outcome
  (T-117's own rule; T-133/P-28 gap 1 re-confirmed it the hard way, see `row-13`'s `scenario.md`). When the
  spec disagrees with that real output, the divergence is recorded separately: `specCategory` for a row with
  a known, single spec-correct category (even one currently unreached), `specRequiresRefusal: true` for a
  row where the spec itself has no single category answer and refusal is the only correct behaviour
  (`types.ts`'s own doc comment has the exact contract).
- `scenario.md` — spec citation, applicable BR-\*, and (for cross-border cells) the masking note below.

A directory with no `order.json` (`row-11-corrected-invoice-384`, `mixed-basket-cross-border`) is a
documentation-only, known-gap entry — `load-cells.ts` skips it; there is no code fix inside this matrix's
scope for it.

## Why two axes, not one chained pipeline

Both real subscribers call `selectProfile` before `buildInvoice`, and `selectProfile` rejects any non-German
buyer unconditionally (P-13). Every category that needs P-12/P-16/P-19 to manifest (K, cross-border AE,
cross-border services) also needs a non-DE buyer — so a strictly chained pipeline (abort on the first
throwing stage) would let P-13 mask the other three on every cross-border cell, and they could never show
red independently. Each cell therefore checks two independent axes off the one real mapper output — `build`
(mapper → `buildInvoice`) and `profile` (the mapper's own B2G signal → `selectProfile`) — never a hand-built
`CommerceInvoiceInput`. Where a cross-border cell's profile axis is red, its `scenario.md` says explicitly
that `selectProfile` would in fact fire first in production, masking whatever the build axis shows.

## Running it

- `pnpm --filter @normwerk/einvoice-medusa test` — fast, no Docker: every cell's build/profile axis against
  real, unmocked adapter functions (`src/tax-matrix/tax-matrix.test.ts`).
- `pnpm conformance:tax-matrix` — Docker, real KoSIT: only cells whose `expected.build.kind === "ok"` (no
  point serializing a cell that never reaches `buildInvoice` successfully). Runs the whole set three times
  in one invocation and asserts byte-identical XML and identical verdicts across all three runs.

## The matrix

| Cell                                             | `docs/tax-semantics.md` row | Build axis                                        | Profile axis                     | Bucket / owning task                                                                  |
| ------------------------------------------------ | --------------------------- | ------------------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------- |
| `row-01-domestic-standard` (+ credit-note)       | 1 (S 19%)                   | ok, S                                             | ok, EN16931                      | —                                                                                     |
| `row-02-domestic-reduced` (+ credit-note)        | 2 (S 7%)                    | ok, S                                             | ok, EN16931                      | —                                                                                     |
| `row-03-intra-eu-goods` (+ credit-note)          | 3 (K)                       | error, `TaxRuleError`                             | error, `UnsupportedCountryError` | **P-12** (build) / **P-13** (profile) → T-079 / T-066                                 |
| `row-04-export-goods` (+ credit-note)            | 4 (G)                       | **ok, G** (tax logic correct)                     | error, `UnsupportedCountryError` | **P-13** (profile only) → T-066                                                       |
| `row-05-reverse-charge` (+ credit-note)          | 5 (AE)                      | ok, **S** (spec: AE)                              | ok, EN16931                      | **P-14** (build only) → T-069                                                         |
| `row-06-exempt` (+ credit-note)                  | 6 (E)                       | ok, **S** (spec: E)                               | ok, EN16931                      | **P-14** (build only) → T-069                                                         |
| `row-07-oss-b2c` (+ credit-note)                 | 7 (OSS/S)                   | error, `TaxRuleError` (unresolved)                | error, `UnsupportedCountryError` | **P-26** new finding (build) / **P-13** (profile) → T-069 / T-066                     |
| `row-08-zero-rated-photovoltaic` (+ credit-note) | 8 (Z)                       | ok, **S** (spec: Z)                               | ok, EN16931                      | **P-14** (build only) → T-069                                                         |
| `row-09-mixed-rates` (+ credit-note)             | 9 (S twice)                 | ok, S                                             | ok, EN16931                      | —                                                                                     |
| `row-11-corrected-invoice-384`                   | 11 (doc type 384)           | n/a — unconstructible                             | n/a                              | out of scope for v0.1 (document-type modeling)                                        |
| `row-12-eu-b2b-service` (+ credit-note)          | 12 (AE, no artifact)        | error, `TaxRuleError` (same as row 3)             | error, `UnsupportedCountryError` | **P-16** root cause / **P-12** proximate / **P-13** (profile) → T-069 / T-079 / T-066 |
| `row-13-non-eu-b2b-service` (+ credit-note)      | 13 (CONTESTED)              | ok, **G** (spec: must refuse)                     | error, `UnsupportedCountryError` | **P-16**, most severe form (build) / **P-13** (profile) → T-069 / T-066               |
| `reject-seller-not-de`                           | mandatory rejection         | error, `TaxRuleError` — **works correctly today** | ok, EN16931                      | — (proves the one guard that's already right)                                         |
| `mixed-basket-domestic`                          | policy cell, no single row  | ok, S — **genuinely correct**                     | ok, EN16931                      | — (regression guard for a future cross-border-mixed guard, T-133/P-28 gap 4a)         |
| `mixed-basket-cross-border`                      | policy cell, no single row  | n/a — unconstructible                             | n/a                              | blocked on a full P-16 fix (per-line `supplyType`) — T-133/P-28 gap 4a                |

`row-03`/`row-05`/`row-07` each double as their table's namesake mandatory rejection ("K without evidence",
"AE without override", "OSS without `ossRateOverride`") — the adapter has no field to supply evidence,
override, or an OSS registration flag at all, so every attempt at those categories is unconditionally
"without" whatever the rejection names. A `supplyType: "mixed"` mandatory-rejection cell is similarly
impossible to construct today — `mixed-basket-cross-border`'s own `scenario.md` has the full reasoning (not
just a missing override field, like P-14's rows 5/6/8, but a missing _concept_: `decideVatCategory` resolves
one category for the whole transaction, and `supplyType` is a single hardcoded `"goods"` value, part of
**P-16**) — while `mixed-basket-domestic` proves the one half of that scenario the real adapter _can_
construct today: a mixed goods/service basket domestically is, correctly, unconditionally green.

## New findings beyond the five named bugs

Both queued in `ecom docs/plan-v0.1-pending.md`, drafted as part of T-117, not fixed here:

- **P-25** — `delivery` (BG-13) is never mapped by `mapOrderToCommerceInvoiceInput`/`MapOrderOptions` at
  all. Even after P-12/P-13 land, a real K-category order would still fail `buildInvoice`'s existing
  `MissingDeliveryInfoForIntraCommunitySupplyError` guard (`BR-IC-11`/`BR-IC-12`). Not directly observable
  today — P-13 masks everything before it would matter — documented on `row-03`'s `scenario.md`.
- **P-26** — `taxContext.ossRegistered` is a hardcoded `false` constant, not sourced from config or order
  data — a merchant has no way to declare OSS registration at all. Documented on `row-07`'s `scenario.md`.

## Result

First real run (2026-09-17): every cell's build/profile axis matched its pre-written prediction exactly, no
cell showed an unpredicted failure, and the 14 cells expected to validate all passed real KoSIT, three
times, deterministically (including `row-05`/`row-13` — proving for real, not just asserting, that a wrong
category still produces a fully KoSIT-valid document). Full pass/fail detail: run `pnpm --filter
@normwerk/einvoice-medusa test` and `pnpm conformance:tax-matrix` directly rather than trusting a stale
summary here.

Of the five named bugs, **P-12, P-13, P-14, and P-16 are directly, empirically red** — a live cell fails (or
silently misresolves) for exactly that reason. **P-19 is not** — it sits a third layer behind P-13 and P-12
on `row-03` (see that cell's `scenario.md` for the full chain) and can only produce a live, fatal KoSIT
rejection once category K is actually reachable end to end, which nothing in this repo can do yet. P-19 is
confirmed real by direct code inspection (`build-invoice.ts` has a `BR-IC-11`/`BR-IC-12` guard next to the K
branch and no equivalent for `BR-IC-02`) and `row-03` is already the cell that will catch it live the moment
P-12/P-13/P-25 are fixed — re-run that same cell then, rather than writing a new one.

## T-133 follow-up (2026-09-17): four review gaps closed (P-28)

A review of the first real run (P-28) found four gaps, closed here:

1. **`row-13`'s `build` looked like a passing expectation** — `{ kind: "ok", category: "G" }` with no
   structured marker that the spec disagrees. It still reads that way on purpose (see that cell's
   `scenario.md`: `build` is asserted against real, current code and can't say "error" without actually
   being wrong); `specRequiresRefusal: true` is what now makes the divergence machine-visible instead of
   prose-only.
2. **`specCategory`/intent was unrecorded on rows 12/13.** Row 12 now carries `specCategory: "AE"` (the
   research verdict was always unambiguous — only its _use_ is blocked pending M-006); row 13 now carries
   `specRequiresRefusal: true` (genuinely no single category — CONTESTED). See `types.ts`'s updated
   `CellExpectation` doc comment for the full contract.
3. **Row 8 (category Z) had no cell and no explanation.** `row-08-zero-rated-photovoltaic` (+ credit-note)
   closes it — the one cell in this matrix that could ever catch a "BT-120/121 added just in case" bug,
   since `BR-Z-10` is the sole rule here that forbids an exemption reason instead of requiring one.
4. **Two cells the original task text explicitly called for were never written.** `mixed-basket-domestic`
   (real, green — proves a goods+service basket doesn't wrongly trip anything domestically) and
   `mixed-basket-cross-border` (documentation-only — explains, precisely, why the cross-border half is
   currently unconstructible) close the first. The second — one order, two `order.fulfillment_created`
   events, two documents, numbering that doesn't collide — needed the real subscriber, not this fixture
   harness; see `../../src/subscribers/invoice-on-fulfillment-created.split-fulfillments.test.ts`. **Real
   finding, not a clean pass**: numbering/idempotency genuinely don't collide, but `fulfillment_id` is never
   used to scope _which lines_ get invoiced — both documents map the entire order every time. "Split into
   two shipments" is not, today, a working escape hatch for a mixed-category cross-border order; an error
   message must not promise it until a real per-fulfillment split exists. Queued as **P-30**
   (`ecom docs/plan-v0.1-pending.md`).
