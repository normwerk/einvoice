# mixed-basket-domestic

Not tied to a single `docs/tax-semantics.md` row — a policy cell, pairing with `mixed-basket-cross-border`.

**What it proves.** A "mixed basket" — one order with both a goods line and a service line — is not the same
thing as "mixed categories". A domestic DE→DE B2B order stays correctly green under category **S**
regardless of how many of its lines are goods versus services: for a domestic order `decideVatCategory`
only branches on seller/buyer country, buyer type, and an explicit `regimeOverride` — never on line
composition or `supplyType` — so mixing goods and services on one domestic invoice is not at risk of
mis-resolving.

**The order really is mixed.** `items[1].requires_shipping: false` makes the mapper derive
`taxContext.supplyType: "mixed"` for this order (one goods line, one service line) — and the domestic
branch still resolves **S**, ignoring it, exactly as designed. This is the regression guard for the
cross-border refusal (`mixed-basket-cross-border`, `MixedSupplyCrossBorderError`): it proves that refusal
does not overreach into rejecting a domestic mixed basket.

- **Build axis**: expected **ok**, category **S** — genuinely correct, not a known bug.
- **Profile axis**: DE buyer, no B2G reference — expected **ok**, `EN16931`.

No known bug.
