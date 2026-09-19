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

A directory with no `order.json` (`row-11-corrected-invoice-384`) is a documentation-only, known-gap entry
— `load-cells.ts` skips it; there is no code fix inside this matrix's scope for it. (`mixed-basket-cross-
border` used to be one too, until T-069 made it constructible — see its own `scenario.md`.)

## Why two axes, not one chained pipeline

Both real subscribers call `selectProfile` before `buildInvoice`. Until **T-066** fixed **P-13**,
`selectProfile` rejected any non-German buyer unconditionally — every category that needs P-12/P-16/P-19 to
manifest (K, cross-border AE, cross-border services) also needs a non-DE buyer, so a strictly chained
pipeline (abort on the first throwing stage) would have let P-13 mask the other three on every cross-border
cell, and they could never have shown red independently. The two-axis design paid for itself again the
moment P-13 was fixed: nothing about `build`/`profile` being checked independently needed to change, only
the fixture predictions did (see the T-066 follow-up below) — a cell whose profile axis still legitimately
refuses (a clearance-model or genuinely out-of-scope buyer country) still needs to be distinguishable from
one whose build axis refuses for an unrelated tax reason. Each cell therefore checks two independent axes
off the one real mapper output — `build` (mapper → `buildInvoice`) and `profile` (the mapper's own B2G
signal → `selectProfile`) — never a hand-built `CommerceInvoiceInput`.

## Running it

- `pnpm --filter @normwerk/einvoice-medusa test` — fast, no Docker: every cell's build/profile axis against
  real, unmocked adapter functions (`src/tax-matrix/tax-matrix.test.ts`).
- `pnpm conformance:tax-matrix` — Docker, real KoSIT: only cells whose `expected.build.kind === "ok"` (no
  point serializing a cell that never reaches `buildInvoice` successfully). Runs the whole set three times
  in one invocation and asserts byte-identical XML and identical verdicts across all three runs.

## The matrix

| Cell                                             | `docs/tax-semantics.md` row    | Build axis                                                                                   | Profile axis                       | Bucket / owning task                                                                                                                                                          |
| ------------------------------------------------ | ------------------------------ | -------------------------------------------------------------------------------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `row-01-domestic-standard` (+ credit-note)       | 1 (S 19%)                      | ok, S                                                                                        | ok, EN16931                        | —                                                                                                                                                                             |
| `row-02-domestic-reduced` (+ credit-note)        | 2 (S 7%)                       | ok, S                                                                                        | ok, EN16931                        | —                                                                                                                                                                             |
| `row-03-intra-eu-goods` (+ credit-note)          | 3 (K)                          | **ok, K** (T-079 fixed P-12/P-25/P-19)                                                       | **ok, EN16931** (T-066 fixed P-13) | —                                                                                                                                                                             |
| `row-03-intra-eu-goods-no-vat-id-evidence`       | 3 (K), mandatory rejection     | error, `TaxRuleError`                                                                        | **ok, EN16931** (T-066 fixed P-13) | —                                                                                                                                                                             |
| `row-04-export-goods` (+ credit-note)            | 4 (G)                          | **ok, G** (tax logic correct)                                                                | **ok, EN16931** (T-066 fixed P-13) | —                                                                                                                                                                             |
| `row-05-reverse-charge` (+ credit-note)          | 5 (AE)                         | **ok, AE** (T-069 fixed P-14)                                                                | ok, EN16931                        | —                                                                                                                                                                             |
| `row-06-exempt` (+ credit-note)                  | 6 (E)                          | **ok, E** (T-069 fixed P-14)                                                                 | ok, EN16931                        | —                                                                                                                                                                             |
| `row-07-oss-b2c` (+ credit-note)                 | 7 (OSS/S)                      | **ok, S** (T-136 fixed P-26)                                                                 | **ok, EN16931** (T-066 fixed P-13) | —                                                                                                                                                                             |
| `row-07-oss-b2c-no-rate-override`                | 7 (OSS/S), mandatory rejection | error, `TaxRuleError` ("needs taxContext.ossRateOverride")                                   | **ok, EN16931** (T-066 fixed P-13) | —                                                                                                                                                                             |
| `row-08-zero-rated-photovoltaic` (+ credit-note) | 8 (Z)                          | **ok, Z** (T-069 fixed P-14)                                                                 | ok, EN16931                        | —                                                                                                                                                                             |
| `row-09-mixed-rates` (+ credit-note)             | 9 (S twice)                    | ok, S                                                                                        | ok, EN16931                        | —                                                                                                                                                                             |
| `row-11-corrected-invoice-384`                   | 11 (doc type 384)              | n/a — unconstructible                                                                        | n/a                                | out of scope for v0.1 (document-type modeling)                                                                                                                                |
| `row-12-eu-b2b-service` (+ credit-note)          | 12 (AE, no artifact)           | **error, `TaxRuleError`** (T-069 fixed P-16 — spec-correct refusal pending M-006, not a bug) | **ok, EN16931** (T-066 fixed P-13) | —                                                                                                                                                                             |
| `row-12-eu-b2b-service-override`                 | 12 (AE, merchant-declared)     | **ok, AE** (T-135 fixed P-34 — `regimeOverride: { kind: "reverse-charge-cross-border" }`)    | **ok, EN16931** (T-066 fixed P-13) | —                                                                                                                                                                             |
| `row-13-non-eu-b2b-service` (+ credit-note)      | 13 (CONTESTED)                 | **error, `TaxRuleError`** (T-069 fixed P-16 — was silently `ok, G`)                          | error, `UnsupportedCountryError`   | — (genuinely out of v0.1 scope: US falls into `profile.ts` branch 5 — not P-13, T-066 confirmed this cell unchanged; stale `knownBugs: ["P-13"]` label removed by T-136/P-35) |
| `reject-seller-not-de`                           | mandatory rejection            | error, `TaxRuleError` — **works correctly today**                                            | ok, EN16931                        | — (proves the one guard that's already right)                                                                                                                                 |
| `mixed-basket-domestic`                          | policy cell, no single row     | ok, S — **genuinely correct**                                                                | ok, EN16931                        | — (regression guard for `mixed-basket-cross-border`, T-133/P-28 gap 4a)                                                                                                       |
| `mixed-basket-cross-border`                      | policy cell, no single row     | **error, `MixedSupplyCrossBorderError`** (T-069 made this constructible)                     | **ok, EN16931** (T-066 fixed P-13) | —                                                                                                                                                                             |

`row-03`/`row-03-...-no-vat-id-evidence`/`row-07-oss-b2c-no-rate-override` each demonstrate their table's
namesake mandatory rejection ("K without evidence", "OSS without `ossRateOverride`") — `row-05`'s "AE without override" case
closed along with P-14 (T-069), since the adapter can now supply one. A `supplyType: "mixed"`
mandatory-rejection cell was impossible to construct before T-069 — `mixed-basket-cross-border`'s own
`scenario.md` has the full history — and is now `mixed-basket-cross-border` itself, pairing with
`mixed-basket-domestic`, which proves the one half of that scenario the real adapter always got right: a
mixed goods/service basket domestically is, correctly, unconditionally green.

## New findings beyond the five named bugs

Both queued in `ecom docs/plan-v0.1-pending.md`, drafted as part of T-117, not fixed here:

- **P-25** — ✅ fixed by **T-079** (2026-09-17): `mapOrderToCommerceInvoiceInput` now maps `delivery`
  (BG-13) from `shipping_address`, falling back to `billing_address`. Was: never mapped at all, so even
  after P-12/P-13 landed, a real K-category order would still have failed `buildInvoice`'s existing
  `MissingDeliveryInfoForIntraCommunitySupplyError` guard (`BR-IC-11`/`BR-IC-12`).
- **P-26** — ✅ fixed by **T-136** (2026-09-19): `taxContext.ossRegistered` used to be a hardcoded `false`
  constant, not sourced from config or order data at all — a merchant had no way to declare OSS registration.
  Now sourced from `EinvoiceModuleOptions.ossRegistered` (merchant config) plus
  `order.metadata.oss_rate_override` (per-order rate) — see the T-136 follow-up section below.

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

## T-079 follow-up (2026-09-17): P-12/P-25/P-19 closed, `row-03` reaches category K for real

`row-03-intra-eu-goods`'s own `scenario.md` documented a three-bugs-deep masking chain — P-13 (profile) masks
P-12 (no VIES evidence path), which masks P-25 (`delivery` never mapped), which masks P-19 (no `BR-IC-02`
guard) — and named this exact cell going green on re-run as T-079's acceptance criterion. All three build-axis
blockers are now closed:

- **P-12**: `EinvoiceModuleOptions.vatIdVerifier` (new, optional field); both subscribers call `.verify()`
  before `buildInvoice` and pass the result as `vatIdEvidence` (ADR-003 — I/O stays outside `buildInvoice`).
- **P-25**: `mapOrderToCommerceInvoiceInput` now maps `delivery` (BG-13) from `shipping_address`, falling
  back to the same address `resolveBuyerAddress` already falls back to; `actualDeliveryDate` uses the
  invoice's own `issueDate` (a deliberate simplification, documented in the mapper's own doc comment — not a
  guessed-at new Medusa query field).
- **P-19**: `build-invoice.ts` gained `MissingBuyerVatIdError` (`BR-IC-02`, category K) and
  `MissingBuyerIdentifierForReverseChargeError` (`BR-AE-02`, category AE), next to the pre-existing
  `BR-IC-11`/`BR-IC-12` delivery guard.

The harness itself needed one real extension to prove any of this: `run-cell.ts`/`load-cells.ts`/`types.ts`
had no way to give a cell scripted VAT-ID evidence at all (`deps.buildInvoice(input)` took no options).
Added an optional `vat-id-evidence.json` per cell directory, same pattern `select-profile-options.json`
already established.

`row-03-intra-eu-goods` (+ credit-note) now scripts a positive VIES check and goes **ok, K** on the build
axis — genuinely, through the real, unmocked adapter, not asserted by relaxing the fixture. Its own
`scenario.md` doc comment about "no synthetic order shape could reach K with evidence, so a separate
rejection fixture would be redundant" stopped being true the moment K became reachable — split into a new
`row-03-intra-eu-goods-no-vat-id-evidence` cell, which keeps proving the "K without evidence" mandatory
rejection `decideVatCategory` still enforces by design.

**Deliberately not touched: `row-12-eu-b2b-service`.** It stays red with the exact same `TaxRuleError` as
before — not because P-12's fix doesn't apply, but because scripting evidence for it _before_ T-069 fixes
`supplyType` would make this service order silently resolve to category K instead of AE (the P-16 danger
`plan-v0.1-pending.md`'s P-19 entry names explicitly: "a fix to one bug opening a different one, catchable
only by fixing both together"). Correctly staying on the current, safe error until T-069 lands.

Regression: `pnpm --filter @normwerk/einvoice-commerce test` (77 tests, including new `BR-IC-02`/`BR-AE-02`
unit tests) and `pnpm --filter @normwerk/einvoice-medusa test` (111 tests, up from 109 — the new negative
fixture) both green; `pnpm typecheck`/`pnpm lint`/`pnpm format` clean. `pnpm conformance:tax-matrix` (real
Docker KoSIT) confirms this isn't just internally consistent: `row-03-intra-eu-goods` and its credit-note
twin now join the "validated" set and both genuinely pass the real validator, 3x deterministically (19/19
validated cells pass) — the K-category XML this task makes reachable really is KoSIT-valid.

## T-069 follow-up (2026-09-19): P-14/P-16/P-20 closed, five cells changed state

`regimeOverride` and `supplyType` were the two remaining gaps T-117's first run named (P-14: no way to
supply an override at all, so AE/E/Z silently fell through to S with no error; P-16/P-20: `supplyType` was
read by nothing, so a cross-border service fell into whichever goods-shaped branch matched its country).
Both are closed:

- **P-14**: entirely a mapper fix — `order.metadata.regime_override` (this plugin's own convention, on
  `order.metadata` rather than `customer.metadata`: a reverse-charge/exempt/zero-rated call is a fact about
  _this transaction_, not a standing fact about the customer) is now threaded through
  `mapOrderToCommerceInvoiceInput` into `taxContext.regimeOverride`.
- **P-16/P-20**: `mapOrderToCommerceInvoiceInput` now derives `supplyType` per line from
  `items[].requires_shipping` (a real, verified column on `@medusajs/order`'s own line-item model, not a
  guessed-at field — `docs/domain-glossary.md`'s new T-069 entry has the verification) and aggregates it to
  the one whole-order value `decideVatCategory` consumes. `decideVatCategory` (`@normwerk/einvoice-commerce`)
  gained two new branches (row 12: EU B2B service, row 13: non-EU B2B service) and a blanket
  cross-border-mixed guard (`MixedSupplyCrossBorderError`, its own distinct class per D-50 point 3) — all
  three checked ahead of the K/G branches they'd otherwise fall into.

**Five cells changed state, three of them newly green and real-KoSIT-proven:** `row-05`/`row-06`/`row-08`
(reverse-charge/exempt/zero-rated) now resolve `ok, AE`/`E`/`Z` respectively through the real adapter, and
all three pass real KoSIT 3x deterministically (see the regression line below) — not asserted, proven.
`row-05` also surfaced a genuine, previously-undiscoverable finding of its own: once AE became reachable,
T-079's `BR-AE-02` guard correctly refused it — the fixture's buyer had no VAT-ID or legal-registration
identifier, a real missing fact in synthetic test data, not a code gap (fixed by adding one, matching the
buyer VAT-ID `packages/einvoice-commerce`'s own root fixture already uses for this scenario).

**Two cells changed from a silently-wrong green to a correct refusal — the sharpest form of what T-117
exists to catch.** `row-13` used to resolve `ok, G` for a non-EU B2B _service_ order — the exact category a
goods export would get, fully KoSIT-valid, for a scenario the spec explicitly says must not be resolved
automatically. It now refuses, citing row 13's own CONTESTED status. `row-12` is subtler: **de-confounded in
two steps, on purpose** (`todo.md`'s own T-069 instruction) so the fix could be isolated from T-079's
separate VAT-ID-evidence fix — first, giving the cell evidence (with no code change yet) made it resolve
`ok, K`, live proof `supplyType` was being ignored; only then did the `supplyType` fix land, moving the cell
from `ok, K` (wrong) to a refusal citing `docs/tax-semantics.md` row 12's own "no artifact, pending M-006"
rule. Auto-resolving row 12 to AE was considered and explicitly rejected (a real decision point during this
task) — the row's own written instruction is "refuse," matching row 13, not a guess just because the
category itself is settled.

**`mixed-basket-cross-border` stopped being documentation-only.** Before T-069 there was no way for any
synthetic Medusa order to even express "this order needs two categories" — not a missing override field
(P-14's shape) but a missing concept. `supplyType`'s per-line derivation and whole-order aggregation made
that concept real, so this cell now has an `order.json` (one goods line, one service line, cross-border EU
buyer) and refuses with `MixedSupplyCrossBorderError`. `mixed-basket-domestic` was upgraded alongside it —
before T-069 nothing distinguished a "service" line from a "goods" one at all, so it was vacuously green;
now it genuinely exercises a real mix and still correctly stays `S`, proving the domestic side of D-50 point
2 for real.

**Deliberately not touched: `row-07-oss-b2c`.** P-26 (`ossRegistered` hardcoded `false`) is the same family
of gap but was never merged into `todo.md`'s live T-069 entry (only P-14/P-16/P-20 are named there) —
flagged rather than silently folded in. This cell stays exactly as red as it was.

Regression: `packages/einvoice-commerce test` — 81 tests (up from 77: new `MixedSupplyCrossBorderError`,
row 12/13, and domestic-ignores-`supplyType` unit tests). `packages/einvoice-medusa test` — 117 (up from
111: mapper unit tests for `regimeOverride`/`supplyType` derivation, plus `mixed-basket-cross-border`'s two
new axis tests). `pnpm typecheck`/`pnpm lint`/`pnpm format` clean across the repo.
`pnpm conformance:tax-matrix` (real Docker KoSIT): 17/17 validated cells pass, 3x deterministic —
`row-05`/`row-06`/`row-08` newly join the validated set (their AE/E/Z documents are genuinely KoSIT-valid,
not just internally consistent); `row-12`/`row-13`/`mixed-basket-cross-border` correctly leave it, since a
refusal never reaches serialization.

## T-135 follow-up (2026-09-19): P-34 closed — a cross-border B2B service had no way out at all

T-069 made `row-12` refuse correctly (pending M-006), but left it a dead end: `regimeOverride: { kind:
"reverse-charge" }` (row 5's own escape hatch) explicitly rejects any non-DE buyer, so a German seller of a
cross-border EU B2B service — SaaS, consulting, other digital services, an ordinary scenario for this
project's audience (D-36) — had **no way**, default or declared, to get a document out at all. Found during
T-069's own verification pass, queued as **P-34**.

Closed the same way category K already handles the analogous gap (row 3's `intra-eu-confirmed` override): a
new, separate `RegimeOverride` kind, `reverse-charge-cross-border` (`@normwerk/einvoice-commerce`'s
`types.ts`), lets a merchant declare the fact and reach **AE** with `VATEX-EU-AE` and its own `ruleId`
(`tax-semantics#12`) — a distinct kind from row 5's `reverse-charge`, not a relaxed guard on it, since
§13b UStG (domestic) and §3a Abs. 2 UStG/Art. 44+196 (cross-border) are different legal bases and merging
them would lose the `ruleId`/exemption-text trail M-006's eventual reviewer checks against. `decideVatCategory`
still never infers AE for this row on its own — only a merchant-declared fact reaches it (D-37). Row 5's own
override, applied cross-border, still refuses — its error message now names row 12's override by name
instead of the stale "not covered by this v0.1 rule table" text T-069 left behind.

New cell `row-12-eu-b2b-service-override` — same DE→FR B2B service order as `row-12-eu-b2b-service`, plus
`order.metadata.regime_override: { kind: "reverse-charge-cross-border" }` — resolves `ok, AE` through the
real, unmocked adapter and passes real KoSIT, 3x deterministically. `docs/tax-semantics.md` rows 5 and 12
were updated per the task's own instruction: row 5 now says explicitly, in the table itself, that it is
domestic-only and that row 12 is the cross-border counterpart with its own override; row 12's norm-source
cell now documents the override escape hatch next to the "refuse pending M-006" rule it qualifies.

Regression: `packages/einvoice-commerce test` — 84 tests (up from 81: new AE-via-override test, two
out-of-scope-override tests, and an updated row-5-cross-border-context test). `packages/einvoice-medusa
test` — 119 (up from 117: the new cell's two axis tests). `pnpm typecheck`/`pnpm lint`/`pnpm format` clean
across the repo — including `pnpm codegen`, whose regenerated `packages/einvoice-commerce/src/generated
/json-schema.ts` (the new `RegimeOverride` member) is a clean, purely additive 16-line diff, confirming
T-134's codegen/prettier gate still holds. `pnpm conformance:tax-matrix` (real Docker KoSIT): 18/18 validated
cells pass, 3x deterministic — `row-12-eu-b2b-service-override` joins the validated set as a genuinely
KoSIT-valid AE document, not just an internally-consistent one.

## T-066 follow-up (2026-09-19): P-13 closed — geography by recipient, not a blanket ban by buyer

`selectProfile` (`@normwerk/einvoice-commerce`'s `profile.ts`) rejected **any** non-German buyer country
unconditionally — not the "DK/NO/SE deferred to v0.2" scope its own doc comment claimed, but every
cross-border buyer this matrix exercises (France, Switzerland, the US alike), found and named P-13 during
T-117's first run. Closed per `ecom docs/todo.md`'s own T-066 spec, four branches: (1) a DE buyer with a
Leitweg-ID-_shaped_ `buyerReference` (checked via the pre-existing `looksLikeLeitwegId`, not mere presence —
an ordinary free-text B2B reference is not a B2G signal just because it's non-empty) resolves `XRECHNUNG`;
(2) a DE buyer without one falls back to `preferredProfile ?? "EN16931"`, unchanged; (3) any other EU/EEA
member state, or Switzerland/the UK, now also resolves `preferredProfile ?? "EN16931"` — the Factur-X-
compatible EN 16931 hybrid is accepted EU-wide, and neither CH nor GB runs a clearance system of its own;
(4) Italy and Poland — each with a mandatory clearance e-invoicing platform of its own (SDI, KSeF) that no
EN 16931 document can be submitted through — get a distinct `UnsupportedCountryError` whose message names
that reason, instead of the generic "not yet supported" text. `EU_MEMBER_STATES` (`tax-rules.ts`, T-061) is
reused rather than duplicated; the EEA-only addition (Iceland, Liechtenstein, Norway) and the CH/UK
acceptance were verified directly against efta.int and this repo's own `README.md` country-roadmap table,
not assumed.

**What stays exactly as red as before, on purpose.** `row-13-non-eu-b2b-service` (+ credit-note) and its US
buyer — the US is not EU/EEA, not CH/UK, and not a clearance country, so branch 5 (the original "not yet
supported" refusal) still applies. This is not a residual P-13 symptom; it's v0.1 correctly having no
reviewed e-invoicing basis for a US buyer at all. Re-run: unchanged, byte-for-byte, from before T-066.

**Nine cells flipped from `error, UnsupportedCountryError` to `ok, EN16931` on the profile axis, all through
the real, unmocked adapter, none of it inferred:** `row-03-intra-eu-goods` (+ credit-note),
`row-03-intra-eu-goods-no-vat-id-evidence`, `row-04-export-goods` (+ credit-note), `row-07-oss-b2c` (+
credit-note), `row-12-eu-b2b-service` (+ credit-note), `row-12-eu-b2b-service-override`, and
`mixed-basket-cross-border` — eleven `expected.json` files in total once both credit-note twins are counted.
The build axis is untouched on every one of them (`buildInvoice` never reads `selectProfile`'s output) —
`row-07-oss-b2c`'s build axis stays red on **P-26** alone, `row-12-eu-b2b-service`'s stays a spec-correct
refusal pending M-006, `mixed-basket-cross-border`'s stays `MixedSupplyCrossBorderError`. This is exactly
what the two-axis design (see above) was built to prove: fixing the profile axis changed nothing about
the build axis's own, independent verdict on any of them.

Regression: `packages/einvoice-commerce test` — 92 tests (up from 84: 12 `profile.test.ts` tests replacing
the previous 4, covering all four branches plus the free-text-vs-Leitweg-ID-shape distinction).
`packages/einvoice-medusa test` — 119 (unchanged — no new cells, only eleven `expected.json` predictions
updated to match the real, now-fixed adapter output). `pnpm typecheck`/`pnpm lint`/`pnpm format` clean
across the repo. `pnpm conformance:tax-matrix` (real Docker KoSIT): 18/18 validated cells still pass, 3x
deterministic, unchanged from T-135 — confirming the profile-axis fix really is orthogonal to XML
serialization, not just asserted to be.

## T-136 follow-up (2026-09-19): P-26 closed — a merchant can now declare OSS registration and rate

`row-07-oss-b2c` was the one cell **T-069 explicitly declined to touch** ("the same family of gap but never
merged into `todo.md`'s live T-069 entry") and **T-066 could only close half of** (the profile axis, since
`row-07-oss-b2c`'s build axis has nothing to do with buyer-country geography). `decideVatCategory`'s own
row-7 branch (`tax-rules.ts`) had been correct since T-061 — it already required `ossRegistered: true` and an
explicit `ossRateOverride`, and refused otherwise — but the Medusa adapter hardcoded `ossRegistered: false`
for every order, with no config or order field feeding it at all, so the branch could never fire through the
real adapter. **No cell in this matrix owned the fix until now** — P-26 was mentioned in passing by
`row-07-oss-b2c`'s own scenario and this file's "new findings" section, but no live task claimed it, the
gap `todo.md`'s T-136 entry itself calls out explicitly.

Closed the same way category K (row 3's `intra-eu-confirmed`) and cross-border AE (row 12's
`reverse-charge-cross-border`, T-135) already handle a fact the engine can't infer on its own — except OSS
needs two declared facts at two different tiers, not one `RegimeOverride` variant, since one is a standing
merchant fact and the other is specific to a single order:

- **OSS registration** (`taxContext.ossRegistered`) — `EinvoiceModuleOptions.ossRegistered` (new, optional,
  defaults to `false`), the same tier as `seller`/`payment`, threaded through `MapOrderOptions.ossRegistered`
  into both subscribers' `mapOrderToCommerceInvoiceInput` calls.
- **destination-country rate** (`taxContext.ossRateOverride`) — `order.metadata.oss_rate_override`, a new
  resolver (`resolveOssRateOverride`) mirroring `resolveRegimeOverride`'s own placement rationale: a rate is
  a fact about _this order's_ buyer country, not a standing fact about the merchant, so it belongs on
  `order.metadata` the same way `regime_override` does, not on `EinvoiceModuleOptions`.

`decideVatCategory`/`tax-rules.ts` needed **zero changes** — its row-7 branch, and the guard rejecting OSS
without an explicit rate, were already correct and already unit-tested (`tax-rules.test.ts`'s pre-existing
"row 7" tests). The entire gap was adapter-side: two `TaxContext` fields with real semantics and nowhere to
come from.

`row-07-oss-b2c` (+ credit-note) now resolve **ok, S** at the buyer country's own declared rate (`"21"`, the
Netherlands' real standard VAT rate, not a placeholder) through the real, unmocked adapter, and both pass
real KoSIT, 3x deterministically. The mandatory-rejection half this cell used to double as ("OSS without
`ossRateOverride`") is no longer demonstrated by a now-green cell — split out into a new
`row-07-oss-b2c-no-rate-override` (`ossRegistered: true`, no declared rate), the same way
`row-03-intra-eu-goods-no-vat-id-evidence` split out of `row-03-intra-eu-goods` when T-079 made K reachable.

**Bundled cleanup (P-35, `todo.md`'s own instruction alongside T-136):** `row-13-non-eu-b2b-service` (+
credit-note) carried a stale `knownBugs: ["P-13"]` in `expected.json` — T-066's own follow-up (above) already
rewrote both cells' `scenario.md` prose to say no known bugs remained, but left the structured field
untouched, so the machine-readable field and the human-readable prose disagreed. Removed; both `scenario.md`
files now also name the exact `selectProfile` branch responsible (branch 5, `profile.ts`'s own numbered doc
comment — "anything else: not DE, not EU/EEA, not CH/UK, not a clearance country"), not just "unchanged by
T-066" as before. **After this cleanup, zero cells in the entire matrix carry a `knownBugs` array** — the
release checklist item `todo.md`'s T-136 entry itself names ("матрица T-117 зелёная").

Regression: `packages/einvoice-commerce test` — 92 tests, unchanged (no code changes in this package; its
row-7 unit tests already covered this behavior before T-136). `packages/einvoice-medusa test` — 125 (up from
119: 4 new mapper unit tests for `ossRegistered`/`ossRateOverride`, and the new
`row-07-oss-b2c-no-rate-override` cell's two axis tests). `pnpm typecheck`/`pnpm lint`/`pnpm format` clean
across the repo. `pnpm conformance:tax-matrix` (real Docker KoSIT): 20/20 validated cells pass, 3x
deterministic — `row-07-oss-b2c` and its credit-note twin join the validated set as genuinely KoSIT-valid S
documents at a non-German rate, not just internally consistent.
