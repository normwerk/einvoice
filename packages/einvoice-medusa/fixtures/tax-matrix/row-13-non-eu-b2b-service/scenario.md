# row-13-non-eu-b2b-service

`docs/tax-semantics.md` row 13 — DE→US B2B, service. **CONTESTED**: EC guidance is ambiguous and no
artifact shows a service line resolving to G (export) — the addenda cross-reference (`researches/08-vat-
rules-de-addition-1.md` Q4, `-addition-2.md` Q2, correspondence table in queue entry P-23) reconfirms this
with "a significant negative result" across four artifact corpora, not just an oversight. The spec requires
the code to **refuse** here and ask for an explicit `regimeOverride`, never fall through to the export
branch. No `specCategory` — unlike row 12, no single category is even the _known-but-blocked_ right answer
here; refusal is the only spec-correct behaviour, so `specRequiresRefusal: true` records that instead
(T-133, P-28 gap 1/2).

**Why `build` still reads `{ "kind": "ok", "category": "G" }` instead of an error.** An earlier review (P-28
gap 1) proposed rewriting this cell into row 12's shape — `build: { kind: "error", ... }` — reasoning that
recording today's silent success as the expectation reads as "this is correct". That's right about the
_reading_, but `build`/`profile` are asserted verbatim against the real, unmocked adapter
(`tax-matrix.test.ts`'s `assertAxis`, T-117's own non-negotiable rule: never infer an expectation from
anything but a real run). `decideVatCategory`'s export branch is `sellerCountry === "DE" && !buyerIsEu`
only — it does not read `supplyType` (P-16) at all, so this order really does, today, resolve to `ok, G`
with nothing thrown; writing `error` into `build` here would be exactly the fabrication T-117 forbids, not a
fix for it, and would fail the very next real run. Actually making this cell throw needs `decideVatCategory`
to distinguish services from goods at all, which needs P-16 fixed end to end (mapper `supplyType` plumbing
included) — out of scope for a fixture-only task, owned by T-069. `specRequiresRefusal: true` is what makes
the divergence structurally visible instead: unlike the old state (nothing but prose said this was wrong),
a reader — or a future lint rule — can now tell "spec requires refusal" apart from "adapter refuses" without
re-deriving it from `scenario.md`, without asserting something about live code that isn't true.

This is also, going forward, the sharpest possible regression _catch_: the day P-16 actually changes this
branch's behaviour, `build`'s `kind: "ok"`/`category: "G"` stops matching reality and `tax-matrix.test.ts`
goes red on this cell — exactly the live signal T-117 exists to produce, pointing straight at
`specRequiresRefusal` to say what the new expected outcome should be (an error, not a different category).

This is the sharpest illustration of P-16 in the whole matrix: `decideVatCategory`'s export branch condition
is only `sellerCountry === "DE" && !buyerIsEu` — it does not look at `supplyType` at all, and neither does
any branch before it. A non-EU B2B _service_ order therefore silently resolves to category **G**, the exact
same category a non-EU _goods_ export would get (`row-04-export-goods`) — and because G needs no VAT-ID
evidence or override, nothing stops this from producing a fully assembled, KoSIT-valid invoice. Unlike row
12 (which at least throws, blocked by the missing VIES evidence for what it wrongly treats as K), this cell
produces a real, green, validator-passing document for a scenario the spec explicitly says must not be
resolved automatically — the clearest case in this matrix of "58 green tests coexisting with a wrong
scenario" from T-117's own opening paragraph.

- **Build axis**: expected **"ok", category G** (spec says: must refuse) — known bug **P-16**, most severe
  form. This cell is swept into the Docker gate (`expected.build.kind === "ok"`) specifically to prove the
  KoSIT-valid claim above for real, not just assert it.
- **Profile axis**: buyer country US ≠ DE — expected **error**, `UnsupportedCountryError`. Known bug
  **P-13**, masking the above in the real production call order.

Known bugs: **P-16** (build axis, most severe form), **P-13** (profile axis).
