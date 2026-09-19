# mixed-basket-cross-border

Not tied to a single `docs/tax-semantics.md` row — a policy cell added by T-133 (P-28 gap 4a), pairing with
`mixed-basket-domestic`. Documentation-only until T-069: there was no way to even express "this order is
mixed" through the real adapter — `TaxContext.supplyType` was hardcoded `"goods"` by the mapper and never
read by `decideVatCategory` at all (P-16), so no synthetic order could demonstrate the refusal live.

**The scenario.** DE seller → FR B2B buyer, one order carrying both a goods line (Widget, dispatched to FR
— would resolve to category K on its own) and a service line (Setup consulting — would resolve to AE/refusal
on its own, `row-12`). Two different categories genuinely apply to two different lines of one cross-border
invoice, and `decideVatCategory` resolves exactly one category per document (its own doc comment) — so there
is no single correct EN 16931 category for the document as a whole, and the code must refuse rather than
silently pick one line's category for the entire invoice (the same principle row 13 already follows for a
different reason).

**What made this constructible.** T-069 gave the mapper a real way to derive `supplyType` per line
(`items[].requires_shipping`, this file's own doc comment on the real, verified Medusa field) and aggregate
it to the one whole-order value `decideVatCategory` consumes: all-goods → `"goods"`, all-services →
`"services"`, both present → `"mixed"`. This order's two lines (one `requires_shipping` unset/true, one
`false`) aggregate to `"mixed"` — the first synthetic order in this matrix able to express that at all.

**Why refusal, not per-line category resolution.** True per-line category assignment (`docs/tax-semantics
.md`'s "variant в") is explicitly deferred (D-50 point 6, M-037) until M-006's C-1 resolves — a materially
bigger change (per-line `TaxDecision`s, `BuildResult.decisions` carrying more than one, CII serialization
emitting multiple `ram:ApplicableTradeTax` groups) than this task's scope. `MixedSupplyCrossBorderError`
(not generic `TaxRuleError` — D-50 point 3, so a caller can catch this specific, actionable refusal) is the
honest interim behaviour: refuse cleanly rather than guess, same spirit as row 13.

**What the refusal text does not promise.** Not a fulfillment split — `invoice-on-fulfillment-created
.split-fulfillments.test.ts` (T-133, P-30) already proved the real subscriber maps the _whole_ order on
every `order.fulfillment_created` event, so "ship these separately" is not, today, a working escape hatch.
The message instead names two real outs: two separate invoices (one per supply type), or tagging the line
`"goods"` if the service is genuinely ancillary to it — a single Werklieferung (§3 Abs. 7 UStG), a question
of fact for M-006, not something this code can determine on its own (the same doctrine `row-08`'s own
`scenario.md` cites for its photovoltaic-installation example).

- **Build axis**: expected **error**, `MixedSupplyCrossBorderError`.
- **Profile axis**: buyer country FR ≠ DE — expected **error**, `UnsupportedCountryError`. Known bug
  **P-13**, masking the above in the real production call order (would fire first, before `buildInvoice` is
  ever reached).

Known bugs: **P-13** (profile axis only — the build axis is spec-correct refusal, not a bug).
