# ADR-004: Serialization and determinism

**Status:** Accepted — 2026-09-13

## Context

The differential oracle (L4, ADR-005) and every golden-file test compare our output byte-for-byte against
a reference. Neither works if the same input can produce two different — even if equally valid — outputs.
`AGENTS.md` §10 already states the byte-stability requirement; this ADR is where the concrete mechanics
that satisfy it live.

## Decision

**The serialization plan is data, not code.** A generated (ADR-002) tree of `PlanNode`s (element / value /
attribute / repeat, plan-v0.1 §4.2) carries element order, model paths, and value formats. The serializer
is a single interpreter (~200 lines) that walks this tree; it does not change when a profile is added — a
new profile is a new plan plus its own prechecks, never a new branch in the interpreter.

**Element order comes from the plan, which comes from the XSD.** Never computed, sorted, or
alphabetized at runtime — the interpreter emits child nodes in the plan's own order, which is the XSD's
`<xs:sequence>` order at generation time.

**Amounts are strings at every boundary.** `type Amount = string` (decimal text, `.` separator, no
thousands separator) in the model and every public API — `BR-CO-10` through `BR-CO-17` compare amounts
exactly, and IEEE-754 doubles lose cents on repeated addition across a real invoice's line count. Internal
arithmetic uses `decimal.js` (MIT); nothing outside the arithmetic step ever sees a JS `number` standing in
for money.

**Rounding: half-up, applied exactly once**, at the point a value is first computed from its inputs — never
re-rounded on an intermediate sum. Amounts round to 2 decimal places, quantities to up to 4, rates to up to 2.

**Totals are computed in one fixed order**, matching the EN 16931 BR-CO rule chain: invoice line → sum of
line net amounts → document-level allowances/charges → per-category taxable base (BG-23) → per-category
tax amount → document totals (BG-22). Any code that needs a total takes this path; there is no second,
shortcut computation anywhere that could disagree with it.

**No non-deterministic input inside model, format, or commerce** (ADR-001 restates the same rule for a
different reason): no `Date.now()`, `Math.random()`, `crypto.randomUUID()`. An issue date, a generated ID,
or "now" for a PDF timestamp is always a parameter supplied by the caller.

**Byte-level output rules:** namespace prefixes are fixed constants, never regenerated per document; UTF-8
without a BOM; LF line endings; no pretty-printing by default (`indent: false` — an opt-in, non-default
knob for human readability only, never used for anything compared byte-for-byte).

**Golden files** in `fixtures/expected/` are compared byte-for-byte in tests; any difference — even
whitespace — is a failing test, not something to eyeball and wave through.

## Consequences

- A function that "just needs today's date for a quick default" still takes it as a parameter — there is
  no exception carved out for convenience, because the exception is exactly what breaks reproducibility
  months later when a fixture fails for a reason nobody can reconstruct.
- Adding pretty-printed output for human debugging is fine as an explicit, opt-in mode; it must never be
  what golden-file tests or the L4 oracle compare.

## Alternatives considered

- **Runtime element ordering** (e.g., a fixed list maintained by hand alongside the serializer) —
  rejected: two sources of truth (the XSD and the hand-list) drift; the plan-as-data approach has exactly
  one.
- **JS `number` for amounts, with careful rounding at output time** — rejected: BR-CO-\* rules compare
  amounts computed at different points in the pipeline; float error compounds across a real invoice's line
  count in ways that are expensive to debug and easy to reintroduce.
