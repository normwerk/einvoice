# mixed-basket-domestic

Not tied to a single `docs/tax-semantics.md` row — a policy cell added by T-133 (P-28 gap 4a), pairing with
`mixed-basket-cross-border` (documentation-only, no runnable fixture — see that cell's own `scenario.md`).

**What it proves.** A "mixed basket" — one order with both a goods line and a service line — is not the same
thing as "mixed categories". A domestic DE→DE B2B order stays correctly green under category **S**
regardless of how many of its lines are goods versus services: `decideVatCategory` only branches on seller/
buyer country, buyer type, and an explicit `regimeOverride` — never on line composition or `supplyType` for
a domestic order (D-50 point 2) — so mixing goods and services on one domestic invoice was never actually at
risk of mis-resolving.

**T-069 made this cell exercise the real mix it always claimed to.** Before T-069, nothing distinguished a
"service" line from a "goods" one at all — this cell's own "Setup consulting" line was, structurally,
indistinguishable from the "Widget" line, so the cell was vacuously green rather than a real proof of
anything. Now `items[1].requires_shipping: false` makes the mapper actually derive
`taxContext.supplyType: "mixed"` for this order (one goods line, one services line) — and the domestic
branch still resolves **S**, ignoring it, exactly as designed. This is the live version of the regression
guard the cell always intended to be: once a cross-border mixed-category guard exists (`mixed-basket-cross-
border`, now a real runnable cell too), this is what proves that guard doesn't overreach into rejecting a
domestic mixed basket.

- **Build axis**: expected **ok**, category **S** — genuinely correct, not a known bug.
- **Profile axis**: DE buyer, no B2G reference — expected **ok**, `EN16931`.

No known bug.
