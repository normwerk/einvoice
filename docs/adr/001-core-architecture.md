# ADR-001: Core architecture — layers, purity, build

**Status:** Accepted — 2026-09-13

## Context

This is a library, not an application: its whole value is being embeddable in whatever runs a merchant's
store (Medusa today, Vendure later, conceivably a plain HTTP wrapper after that). The architecture has to
make that embedding cheap and the core's output byte-stable, without presupposing any particular host.

## Decision

**Layers, strictly ordered, lower never imports higher** (full rule and package list: `AGENTS.md` §6):
model → format → commerce → adapter → conformance. Each package owns one of these; nothing skips a layer.

**The public contract of the core is data, not classes.** What `einvoice-model` exports — the EN 16931
types, code lists, JSON Schema — is a plain, JSON-serializable shape. Nothing downstream needs to know it
came from a generator, subclass anything, or hold a reference to a stateful object graph. This is what
makes an HTTP wrapper (mentioned as a later possibility) feasible without a rewrite.

**Model, format, and commerce are pure functions.** No `Date.now()`, `crypto.randomUUID()`,
`Math.random()`, filesystem, or network access anywhere in these three layers — every such input is a
function parameter. The one deliberate exception is `einvoice-pdfa`, which receives PDF bytes as a
parameter and returns transformed bytes; it never reads or writes a file itself. This is not a style
preference here — the differential oracle (L4) and every golden-file test depend on the same input always
producing the same output (`AGENTS.md` §10, ADR-004).

**No dependency-injection framework.** At this scale — mostly stateless transformations threaded through
plain function calls — a DI container adds indirection (interfaces to satisfy, a container to configure,
a lifecycle to reason about) without solving a problem this codebase actually has. Plain parameters and
object literals are the DI.

**Build: `tsc` per package, not a bundler.** These are Node libraries other packages and consumers
`import`, not something shipped to a browser — there is nothing to bundle. `tsc -p tsconfig.json` per
workspace package (already how the scaffold builds) keeps the toolchain to one thing: the TypeScript
compiler, configured once in `tsconfig.base.json`. TypeScript **project references** are enabled
(`composite: true` on every package) so that once one package imports another (the first case being
`einvoice-cii` depending on `einvoice-model`), `tsc` type-checks against the dependency's already-built
declaration files instead of re-parsing its source — and `pnpm -r build` already builds packages in
dependency order via pnpm's own topological sort, so no separate reference-graph tooling is needed.

**Module format: ESM only.** `"type": "module"`, `moduleResolution: "Bundler"`. Medusa v2's plugin system
is ESM-native, and a dual CJS+ESM build (a second `tsc` pass, or switching to `tsup`) would double the
build and `exports` map surface for a consumer that doesn't need CJS. Revisit if the Medusa/Vendure
adapter compatibility work turns up an actual CJS requirement — check the installed version rather than
assume, the same caution this project already applies to Medusa event names.

## Consequences

- A layer reaching for `Date.now()` or a file read is a design smell, not a place to make an exception —
  the fix is always "accept it as a parameter," never "this one call is fine."
- Every workspace package's `tsconfig.json` carries `composite: true`; a package that starts importing
  another adds a `"references"` entry pointing at it, at the same time the import is added — not
  pre-emptively, since an empty reference edge to nothing imported yet is dead weight.
- `*.tsbuildinfo` files (composite build's incremental cache) are build output, not source — gitignored.

## Alternatives considered

- **`tsup`** — rejected: bundling is a benefit for apps and browser code, not for a Node library with no
  bundling need; it would add a dependency and a config file to maintain for no corresponding gain.
- **Dual ESM+CJS publish** — rejected for now: no known consumer needs `require()`; adds real build
  complexity (two output trees, a more complex `exports` map) against a hypothetical need.
- **A DI framework** (e.g., InversifyJS, tsyringe) — rejected: solves a problem (managing a graph of
  stateful, swappable services) this codebase doesn't have at this size; plain functions are simpler to
  read, test, and keep pure.
