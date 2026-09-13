# Documentation index

Root index for this repository's documentation. Rules for what goes here vs. in the private planning
folder are in `AGENTS.md` §1 and §12.

## Status

Sprint 0 (monorepo scaffold + spikes A/B/C done). Spike findings that landed here: `docs/sources.md`
(artifact licensing) and `docs/tax-semantics.md` (draft VAT scenario table). `einvoice-model` (T-011) is the
first package with real generated content — see below.

## `einvoice-model`

Generated EN 16931 types, code lists, and JSON Schema (`AGENTS.md` §6, ADR-002). Regenerate after editing
`tools/codegen/model/terms.mjs` or updating a vendored artifact:

```bash
pnpm codegen:model
```

Coverage note: this first pass covers every BT/BG term that has its own explicit business rule in the base
EN 16931 CII Schematron (96 terms) — enough to model all 10 scenarios in `docs/tax-semantics.md`, not yet
the full ~155/35 BT/BG set (full postal addresses beyond the seller's country code are the main gap). See
the coverage note at the top of `tools/codegen/model/terms.mjs` for specifics and why.

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

## Fixtures

[`fixtures/`](../fixtures/README.md) holds the base scenario fixtures (T-050): 6 DE VAT scenarios, each an
`Invoice` (model form) plus a `scenario.md` explaining the applicable BR-\* rules and norm source.
Cross-referenced with [`docs/tax-semantics.md`](tax-semantics.md).

## Structure

- [`docs/sources.md`](sources.md) — official artifacts used for code generation: URL, version, hash, licence, vendoring decision (populated by spike A, T-013).
- [`docs/domain-glossary.md`](domain-glossary.md) — EN 16931 domain conventions and pitfalls (AGENTS.md §2).
- [`docs/mapping-reference.md`](mapping-reference.md) — model → CII XPath mapping, generated from
  `packages/einvoice-cii/src/generated/plan.ts` (T-020). Platform field → BT mapping (the adapter side)
  comes later with `einvoice-medusa` (T-070+).
- [`docs/tax-semantics.md`](tax-semantics.md) — what the validators do not catch (draft, not reviewed by a
  tax advisor — M-006; plan-v0.1 §3.5 / §9).
- `docs/test-cases.md` — test catalog by suite.
- `docs/manual-testing.md` — scenarios that cannot be automated.
- [`docs/adr/`](adr/README.md) — architecture decision records (ADR-001…005, plan-v0.1 §3.3).
- `docs/features/<feature>.md` — per-feature docs, added as features ship.
