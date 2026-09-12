# Documentation index

Root index for this repository's documentation. Rules for what goes here vs. in the private planning
folder are in `AGENTS.md` §1 and §12.

## Status

Sprint 0 (monorepo scaffold + spikes). No feature docs yet — nothing is implemented.

## Structure

- `docs/sources.md` — official artifacts used for code generation: URL, version, hash, licence, vendoring decision (populated by spike A, T-013).
- `docs/domain-glossary.md` — EN 16931 domain conventions and pitfalls (created when first needed, AGENTS.md §2).
- `docs/mapping-reference.md` — platform field → BT mapping (mandatory before v0.1, generated from the serialization plan, plan-v0.1 §5).
- `docs/tax-semantics.md` — what the validators do not catch (mandatory before v0.1, plan-v0.1 §3.5 / §9).
- `docs/test-cases.md` — test catalog by suite.
- `docs/manual-testing.md` — scenarios that cannot be automated.
- `docs/adr/` — architecture decision records (ADR-001…005, plan-v0.1 §3.3).
- `docs/features/<feature>.md` — per-feature docs, added as features ship.
