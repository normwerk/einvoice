# row-13-non-eu-b2b-service

`docs/tax-semantics.md` row 13 — DE→US B2B, service. **CONTESTED**: EC guidance is ambiguous and no
artifact shows a service line resolving to G (export) — the addenda cross-reference (`researches/08-vat-
rules-de-addition-1.md` Q4, `-addition-2.md` Q2, correspondence table in queue entry P-23) reconfirms this
with "a significant negative result" across four artifact corpora, not just an oversight. The spec requires
the code to **refuse** here and ask for an explicit `regimeOverride`, never fall through to the export
branch. No `specCategory` for that reason.

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
