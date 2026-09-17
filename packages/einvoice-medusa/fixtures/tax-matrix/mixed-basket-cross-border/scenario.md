# mixed-basket-cross-border (documentation only, no runnable fixture)

Not tied to a single `docs/tax-semantics.md` row. Added by T-133 (P-28 gap 4a) to give the gap its own
matrix entry — T-117's original README already noted, in prose, that a `supplyType: "mixed"`
mandatory-rejection cell was "similarly impossible to construct"; this entry formalizes that as a proper,
visible cell (like `row-11-corrected-invoice-384`) instead of leaving it only in a paragraph.

**The scenario a fixture would need.** DE seller → another EU-state B2B buyer, one order carrying both a
goods line (→ category K, intra-EU supply) and a service line (→ category AE, intra-EU reverse charge) —
two different categories on one cross-border invoice. Per the founder-level decision on this question
(`ecom docs/my-tasks.md`, M-037 variant г): a _domestic_ mixed basket (`mixed-basket-domestic`, this cell's
pair) must stay green — mixing goods and services is not itself the problem — but a _cross-border_ order
that actually needs two different categories on one document has no single correct EN 16931 category to
assign the invoice as a whole, and must refuse rather than silently pick one (the same way row 13 must
refuse rather than default to G).

**Why there is no `order.json`.** `decideVatCategory` resolves exactly one category for the _whole_
transaction (its own doc comment: "the whole commercial transaction... row 9 is not a separate regime, it's
two lines both resolving to category S" — categories are never mixed within one decision), and
`TaxContext.supplyType` is a single value for the whole order, hardcoded `"goods"` by the mapper and never
read by `decideVatCategory` at all (P-16). There is no field anywhere in `MedusaOrderForInvoice` /
`MapOrderOptions` / `TaxContext` that could even express "this order needs two categories" or "this order is
mixed" — not a missing override (like rows 5/6/8's P-14), a missing _concept_. No synthetic order could
attempt this rejection through the real adapter today, the same reason `row-11` has no `order.json`.

**What would make this constructible.** A full P-16 fix that threads real per-line `supplyType` from Medusa
order data through to a per-line-aware tax decision (not just a single whole-order `TaxContext.supplyType`
value) — a materially bigger change than P-14's "add a `regimeOverride` field", tracked separately, not
scoped to this fixture-only task.

Bucket: **blocked on a full P-16 fix** (supplyType is a whole-order value today, not per-line). No known bug
beyond P-16 itself — this cell can't demonstrate one live.
