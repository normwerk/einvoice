# Documentation index

Root index for this repository's documentation. Rules for what goes here vs. in the private planning
folder are in `AGENTS.md` §1 and §12.

## Status

Sprint 0 (monorepo scaffold + spikes A/B/C done; no package has real logic yet). Spike findings that landed
here: `docs/sources.md` (artifact licensing) and `docs/tax-semantics.md` (draft VAT scenario table).

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

## Structure

- [`docs/sources.md`](sources.md) — official artifacts used for code generation: URL, version, hash, licence, vendoring decision (populated by spike A, T-013).
- [`docs/domain-glossary.md`](domain-glossary.md) — EN 16931 domain conventions and pitfalls (AGENTS.md §2).
- `docs/mapping-reference.md` — platform field → BT mapping (mandatory before v0.1, generated from the serialization plan, plan-v0.1 §5).
- [`docs/tax-semantics.md`](tax-semantics.md) — what the validators do not catch (draft, not reviewed by a
  tax advisor — M-006; plan-v0.1 §3.5 / §9).
- `docs/test-cases.md` — test catalog by suite.
- `docs/manual-testing.md` — scenarios that cannot be automated.
- [`docs/adr/`](adr/README.md) — architecture decision records (ADR-001…005, plan-v0.1 §3.3).
- `docs/features/<feature>.md` — per-feature docs, added as features ship.
