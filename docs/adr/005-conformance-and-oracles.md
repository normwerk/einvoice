# ADR-005: Conformance levels and oracles

**Status:** Accepted — 2026-09-13

## Context

`AGENTS.md` §8 already defines the conformance gate (L1–L5) and its rules; this ADR is where that gate's
mechanics — pinning, ordering, and what a "green" run actually certifies — are fixed as an engineering
decision, informed by what spike C (T-044) actually measured running the real validators.

## Decision

**Levels, cheapest first:** profile prechecks (milliseconds, run in unit tests, before anything else) →
L1 XSD → L2 Schematron (KoSIT) → L3 Mustang + veraPDF (PDF-touching changes only) → L4 differential oracles
→ L5 round-trip (nightly + pre-release). Each level only runs when the change it checks is actually
touched — a pure `einvoice-commerce` change doesn't trigger L3.

**A new scenario ships with a fixture. No fixture, no merge** (`AGENTS.md` §8 rule 1) — this is not
negotiable per change, it's the mechanism that keeps the fixture set actually covering what the code does.

**An L4 difference always gets a written verdict**, in the form spike A's licensing table and
`docs/tax-semantics.md` already use for open questions — classified as _our bug_, _their bug_, or
_permissible variation_, citing the EN 16931/CIUS clause that justifies the verdict (plan-v0.1 §8's format).
"Probably fine" is refused as an answer, the same way an unverified license claim was refused in spike A.

**L1–L3 green with an unexplained L4 difference is not green** (`AGENTS.md` §8 rule 3) — the fixture isn't
done until every level that applies to it has an answer, not just the automated ones.

**Validator images are pinned by digest and by the specific artifact's own hash**, not a floating tag —
`docker/images.lock`, built and verified against real tool versions in spike C (KoSIT Validator 1.6.3,
Mustang CLI 2.26.0, veraPDF Greenfield 1.30.2, each with a build recorded there). Bumping a validator
version is its own task with the resulting fixture diff reviewed (`AGENTS.md` §7), never a silent
side-effect of an unrelated dependency update.

**Two independent oracles, not one.** `e-invoice-eu` (WTFPL) and `@stackforge-eu/factur-x` (EUPL-1.2),
devDependencies only, never imported by a published package's runtime code (decision D-17/M-005). Two
oracles specifically so that a shared bug in one implementation doesn't read as agreement.

**What "green" certifies, stated plainly every time a report is published:** structural and business-rule
conformance (L1–L3), and — where checked — agreement with two independent implementations (L4) and
internal consistency under round-trip (L5). It does **not** certify that the chosen VAT category, exemption
text, or numbering scheme was the _right_ one for that transaction (`AGENTS.md` §8 rule 5) — that is
`docs/tax-semantics.md` and, eventually, expert review's (M-006) job, and no validator run substitutes for
either.

## Consequences

- CI cost scales with fixture count roughly the way spike C measured per-file (a few seconds per validator
  per file, well inside the plan's "6 fixtures under 3 minutes" target with room to spare) — the
  cheapest-first ordering keeps the everyday feedback loop fast even as the fixture set grows toward the
  extended set (plan-v0.1 §7).
- Every conformance report this project publishes — including the release checklist item in plan-v0.1
  §10 — restates the L1–L5-vs-tax-semantics distinction explicitly, so "the validator is green" is never
  read as "the invoice is definitely correct."

## Alternatives considered

- **Treating L1–L3 alone as sufficient** — rejected: this is exactly the shortcut `AGENTS.md` §8 rule 3
  exists to close off; L4 differences left unexplained have hidden real bugs in other projects.
- **A single combined oracle** instead of two independent ones — rejected: decided earlier at D-17/M-005,
  for the reason restated above (shared-bug blind spot).
- **Floating validator image tags** (`:latest`) — rejected: contradicts `AGENTS.md` §7 directly, and would
  make a fixture regression impossible to bisect (did our code change, or did the validator?).
