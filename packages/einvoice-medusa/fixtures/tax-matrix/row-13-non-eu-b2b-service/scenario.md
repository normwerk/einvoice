# row-13-non-eu-b2b-service

`docs/tax-semantics.md` row 13 — DE→US B2B, service. **CONTESTED**: EC guidance is ambiguous and no
artifact shows a service line resolving to G (export) — a negative result across four official artifact
corpora, not an oversight. No `specCategory` — unlike row 12, no single category is even the
_known-but-undecided_ right answer here; refusal is the only spec-correct behaviour, so `expected.json`
records `specRequiresRefusal: true`.

`decideVatCategory` has a dedicated row-13 branch — `sellerCountry === "DE" && !buyerIsEu &&
buyerIsBusiness && supplyType === "services"` — checked _before_ the export (G) branch (which itself
excludes services), so a non-EU B2B service order (this cell's line carries `requires_shipping: false`)
never gets the category a goods export gets. Before the engine distinguished services from goods, this
scenario produced a complete, KoSIT-valid document with category G — a validator-green invoice for a
scenario the spec says must not be resolved automatically, the sharpest example in this matrix of what
validators do not catch. `expected.json` records the refusal and its CONTESTED message; a change that let
this order resolve to any category, or refuse for a different reason, fails `tax-matrix.test.ts` on this
cell.

- **Build axis**: expected **error**, `TaxRuleError` (CONTESTED, citing `docs/tax-semantics.md` row 13).
  This cell is not in the Docker gate's "validated" set (only cells with `expected.build.kind === "ok"` are
  serialized) — a refusal never reaches serialization, so there is nothing for KoSIT to check here.
- **Profile axis**: buyer country US — expected **error**, `UnsupportedCountryError`. `selectProfile` has
  five branches (`profile.ts`'s own numbered doc comment), and the US falls into **branch 5** ("anything
  else — not DE, not EU/EEA, not CH/UK, not a clearance country"): a buyer country this release does not
  serve yet, refused with the generic "not yet supported" message — not a bug.

No known bug: both axes are documented refusals.
