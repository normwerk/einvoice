# mixed-basket-domestic

Not tied to a single `docs/tax-semantics.md` row — a policy cell added by T-133 (P-28 gap 4a), pairing with
`mixed-basket-cross-border` (documentation-only, no runnable fixture — see that cell's own `scenario.md`).

**What it proves.** A "mixed basket" — one order with both a goods line and a service line — is not the same
thing as "mixed categories". A domestic DE→DE B2B order stays correctly green under category **S**
regardless of how many of its lines are goods versus services: `decideVatCategory` only branches on seller/
buyer country, buyer type, and an explicit `regimeOverride` — never on line composition or `supplyType` — so
mixing goods and services on one domestic invoice was never actually at risk of mis-resolving. This is true
today, and it's meant to _stay_ true after `supplyType` is eventually threaded through end to end (P-16):
resolving supplyType at all only matters once the buyer is cross-border, not domestically.

**Why it's a regression guard, not just a restatement of row 1.** Nothing distinguishes this cell's _outcome_
from `row-01-domestic-standard` today — both are plain, green, category-S invoices. Its purpose is forward:
once someone implements a cross-border mixed-category guard (part of a full P-16 fix), this cell is what
proves that guard didn't overreach into rejecting a domestic mixed basket too. If this cell ever turns red
after such a change lands, that change is wrong, not this fixture.

- **Build axis**: expected **"ok", category S** — genuinely correct, not a known bug.
- **Profile axis**: DE buyer, no B2G reference — expected **green**, `EN16931`.

No known bug.
