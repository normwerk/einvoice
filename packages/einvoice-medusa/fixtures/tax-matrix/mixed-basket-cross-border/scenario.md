# mixed-basket-cross-border

Not tied to a single `docs/tax-semantics.md` row — a policy cell, pairing with `mixed-basket-domestic`.

**The scenario.** DE seller → FR B2B buyer, one order carrying both a goods line (Widget, dispatched to FR
— would resolve to category K on its own) and a service line (Setup consulting — row 12 on its own: AE by
the table, refused by default, see `row-12-eu-b2b-service`). Two different categories genuinely apply to two
different lines of one cross-border invoice, and `decideVatCategory` resolves exactly one category per
document (its own doc comment) — so there is no single correct EN 16931 category for the document as a
whole, and the code must refuse rather than silently pick one line's category for the entire invoice (the
same principle row 13 follows for a different reason).

**How the order expresses "mixed".** The mapper derives each line's supply type from
`items[].requires_shipping` (`false` → service, `true` or unset → goods; see the field's doc comment in
`order-to-commerce-invoice-input.ts`) and aggregates it to the one whole-order value `decideVatCategory`
consumes: all goods → `"goods"`, all services → `"services"`, both present → `"mixed"`. This order's two
lines (one `requires_shipping` unset, one `false`) aggregate to `"mixed"`. `decideVatCategory` checks a
cross-border `"mixed"` order ahead of every country-specific branch.

**Why refusal, not per-line category resolution.** Assigning a category per line is not implemented: it
needs per-line `TaxDecision`s, `BuildResult.decisions` carrying more than one, and CII serialization
emitting multiple `ram:ApplicableTradeTax` groups — and the service half's own category (row 12) is not
decided yet either. `MixedSupplyCrossBorderError` is its own class, not a generic `TaxRuleError`, so a caller
can catch this specific, actionable refusal without matching on message text. Refusing cleanly rather than
guessing is the same stance as row 13.

**What the refusal text does not promise.** Not a fulfillment split —
`invoice-on-fulfillment-created.split-fulfillments.test.ts` shows the invoice subscriber maps the _whole_
order on every `order.fulfillment_created` event, so shipping the lines separately does not split the
invoice. The message instead names two real outs: two separate invoices (one per supply type), or tagging
the line `"goods"` if the service is genuinely ancillary to it — a single Werklieferung (§3 Abs. 7 UStG), a
question of fact for the merchant and their tax advisor, not something this code can determine on its own
(the same doctrine `row-08`'s own `scenario.md` cites for its photovoltaic-installation example).

- **Build axis**: expected **error**, `MixedSupplyCrossBorderError`.
- **Profile axis**: buyer country FR — expected **ok, `EN16931`**. France is an EU member state, so
  `selectProfile` resolves the EN 16931 hybrid profile like for any other EU/EEA buyer. The two axes are
  checked independently, so a profile-axis refusal could never hide the build-axis result above.
