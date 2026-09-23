# Documentation index

Root index for this repository's documentation. Rules for what goes here vs. in the private planning
folder are in `AGENTS.md` §1 and §12.

## Status

Sprint 0 (monorepo scaffold + spikes A/B/C done). Spike findings that landed here: `docs/sources.md`
(artifact licensing) and `docs/tax-semantics.md` (draft VAT scenario table). `einvoice-model` (T-011) is the
first package with real generated content — see below.

**Using `@normwerk/einvoice-medusa` in a Medusa v2 project?** Start at
[`docs/quickstart-medusa.md`](quickstart-medusa.md) instead of reading this whole index — everything below
is for people working on this repo itself.

## `einvoice-model`

Generated EN 16931 types, code lists, and JSON Schema (`AGENTS.md` §6, ADR-002). Regenerate after editing
`tools/codegen/model/terms.mjs` or updating a vendored artifact:

```bash
pnpm codegen:model
```

Coverage note: the model has 124 BT/BG terms — every term with its own explicit business rule in the base
EN 16931 CII Schematron, the ones the XRechnung rules require, and the first two address lines of each
address — enough to model every scenario in `docs/tax-semantics.md`, not yet the full ~155/35 BT/BG set (a
third address line and several optional groups are missing). See the coverage note at the top of
`tools/codegen/model/terms.mjs` for specifics and why.

Every generated field cites its BT/BG number and is cross-checked against the vendored artifact text before
generation — `tools/codegen/model/generate.mjs` refuses to run if a curated term's name doesn't actually
appear next to that number in the source.

## Conformance validators

`docker/` holds the Docker setup for the official validators (KoSIT Validator for XRechnung, Mustang for
ZUGFeRD/Factur-X, veraPDF for PDF/A-3b), pinned by digest/hash in `docker/images.lock`
(`AGENTS.md` §7). Build once, then validate a file:

```bash
docker compose -f docker/compose.conformance.yml build
pnpm conformance validate <file.xml|file.pdf>
```

This is the spike C (T-044) slice: one file in, one machine-readable JSON report out. The full suite —
all conformance levels (`AGENTS.md` §8), all fixtures, differential oracles — is `einvoice-conformance`'s
later scope (T-040).

## End-to-end suite

[`docs/e2e.md`](e2e.md) — `pnpm e2e` runs a real Medusa v2 store (installed from a disposable local
registry, never workspace-linked) through a real order, checking the resulting e-invoice against the same
KoSIT/veraPDF validators the fixture suite uses (T-078). Proves wiring — that a real order's data reaches
the plugin and comes back out correctly — not tax semantics, which stays the fixture-driven tax-matrix's
job.

## Fixtures

[`fixtures/`](../fixtures/README.md) holds the base scenario fixtures (T-050): 6 DE VAT scenarios, each an
`Invoice` (model form) plus a `scenario.md` explaining the applicable BR-\* rules and norm source.
Cross-referenced with [`docs/tax-semantics.md`](tax-semantics.md).

## Structure

- [`docs/sources.md`](sources.md) — official artifacts used for code generation: URL, version, hash, licence, vendoring decision (populated by spike A, T-013).
- [`docs/conventions.md`](conventions.md) — what internal identifiers like `T-013`/`M-006`/`D-20` mean and
  why they're kept even though they don't resolve to anything public.
- [`docs/domain-glossary.md`](domain-glossary.md) — EN 16931 domain conventions and pitfalls (AGENTS.md §2).
- [`docs/mapping-reference.md`](mapping-reference.md) — model → CII XPath mapping, generated from
  `packages/einvoice-cii/src/generated/plan.ts` (T-020).
- [`docs/mapping-reference-medusa.md`](mapping-reference-medusa.md) — the adapter side: which Medusa
  order/customer field, or which `einvoice-medusa` module option, each BT/BG comes from (T-075). Hand-written,
  not generated.
- [`docs/tax-semantics.md`](tax-semantics.md) — the VAT rules applied, one scenario per row with legal
  sources; what the validators do not catch. Not tax advice.
- [`docs/test-cases.md`](test-cases.md) — test catalog by suite.
- [`docs/manual-testing.md`](manual-testing.md) — scenarios that cannot be automated.
- [`docs/e2e.md`](e2e.md) — `pnpm e2e`: a real Medusa v2 store, installed from a disposable registry, run
  through a real order and checked against the real conformance validators (T-078).
- [`docs/adr/`](adr/README.md) — architecture decision records (ADR-001…005, plan-v0.1 §3.3).
- `docs/features/<feature>.md` — per-feature docs, added as features ship.
  - [`docs/features/einvoice-medusa.md`](features/einvoice-medusa.md) — File Module storage, the admin
    "E-Invoices" widget, and the Store API download endpoint (T-074).
- [`docs/quickstart-medusa.md`](quickstart-medusa.md) — install and configure `einvoice-medusa` in a real
  Medusa v2 project, verified end to end (T-075).
