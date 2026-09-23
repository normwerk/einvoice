# ADR-002: Code generation from official artifacts

**Status:** Accepted — 2026-09-13

## Context

Decision D-17 (see `HOW-WE-GOT-HERE.md` in the private planning log) rules out third-party e-invoicing
libraries in runtime code: serializers are ours, generated from official artifacts. Spike A (T-013)
confirmed which artifacts that can actually mean without buying or redistributing the paid CEN standards
(`docs/sources.md`). This ADR draws the line between what a generator produces and what a person writes,
and how regeneration stays trustworthy.

## Decision

**Generated — committed, never hand-edited (`AGENTS.md` §9):**

- BT/BG TypeScript types with JSDoc naming the official term number, in `einvoice-model`
- Code list union types, from genericode sources, versioned in the module name
- JSON Schema for `validateModel()`
- The CII serialization plan (element order, paths, value formats — plan-v0.1 §4.2's `PlanNode` tree),
  derived from the vendored XSD and Schematron
- BR-\* rule id lists used in profile precheck error messages
- `docs/mapping-reference.md` (BT → serialization path), generated as a side effect of building the plan

**Hand-written — a person's judgment, not derivable from an XSD:**

- Tax category rules (`einvoice-commerce`) — this is the whole reason `einvoice-commerce` exists as a
  separate, hand-written layer (ADR-001); no artifact encodes "which VAT category applies to this order"
- The plan interpreter (~200 lines) — an engine that doesn't change when a profile is added
- Profile prechecks that aren't a mechanical reading of the XSD (e.g., customization-ID matching, BR-DE-\*
  checks specific to XRechnung)
- Orchestration, CLI, and adapter code

**Tooling.** `tools/codegen/*` are plain TypeScript scripts, not a published package, using a
general-purpose XML parser (`fast-xml-parser`, MIT) as a devDependency of the codegen tool only — never a
runtime dependency of anything shipped. No off-the-shelf "XSD-to-TypeScript" generator is used: every one
surveyed produces types and nothing else, while this project's actual output is a serialization _plan_
carrying BT numbers end to end (so `docs/mapping-reference.md` falls out of the plan for free, plan-v0.1
§4.2) — a generic tool would cover a fraction of the job and still need the bespoke plan-builder written
around it.

**Determinism.** Same artifacts in (pinned by hash in `artifacts/MANIFEST.json`) → byte-identical files
out. `pnpm codegen` run twice on a clean tree produces a zero diff — this is a stated W4 acceptance
criterion, not just a nice property. A regeneration that produces a spurious diff is a generator bug, full
stop, never something to "just re-commit."

**Provenance.** Every generated file's header names the generator script and the source artifact id(s) +
version from `MANIFEST.json` — enough to trace "why does this field have this type" back to a specific XSD
or genericode file without spelunking.

**Updating an artifact version** (a new CIUS release, a new codelist release) is its own task: update
`docs/sources.md` and `MANIFEST.json`, regenerate, review the fixture diff, record the behavior change
(`AGENTS.md` §9). Never a silent side effect of an unrelated change.

## Consequences

- Codegen scripts are judged by their output's correctness (does the generated code match the artifact?),
  the same way a compiler is — but once T-011 starts writing them, they get the same test discipline as
  any other production code (`AGENTS.md` §11); "it's just a generator" is not an exemption.
- A contributor who wants to fix a wrong type or a misordered element must find the generator or the
  source artifact, not the generated file — the generated file is where the bug _shows up_, not where it
  lives.

## Alternatives considered

- **quicktype / xsd2ts-style generators** — rejected: types-only output; would not produce the
  serialization plan, JSDoc BT numbers, or mapping-reference docs this project actually needs, so at best
  it replaces a fraction of `tools/codegen/model` and adds a dependency for that fraction.
- **Buying a commercial XSD/schema tool** — rejected: cost aside, it doesn't touch the actual constraint
  (D-19: build the binding without purchasing or redistributing the paid CEN standards) — the free
  artifacts already cover CII/XRechnung end to end (`docs/sources.md`).

## Implementation status (2026-09-23)

Recorded after a review of the code against this decision; the decision itself is unchanged.

- **Generated today:** the model types, code lists and JSON Schema (`tools/codegen/model`, from the vendored
  Schematron and XSD text), the `CommerceInvoiceInput` JSON Schema, the PDF/A font and ICC modules, and
  `docs/mapping-reference.md`.
- **Not generated yet:** the CII serialization plan, `packages/einvoice-cii/src/generated/plan.ts`. It is
  written by hand in the shape a generator would produce ("GENERATED-STYLE FILE" in its header), each path
  looked up in the vendored XSD and Schematron. Its element order is checked indirectly — by KoSIT's XSD
  step on every fixture — not by a generator. `.gitattributes` still marks it `linguist-generated`, which
  hides a hand-written file from GitHub's diff view.
- **Code lists** come from the `BR-CL-*` rules of the vendored Schematron, not from genericode files, and
  the module name carries no version. The tools are `.mjs` scripts using regular expressions, not
  TypeScript with an XML parser. Generated files name their source artifact by path, not by version.
