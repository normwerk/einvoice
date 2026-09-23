# row-12-eu-b2b-service

`docs/tax-semantics.md` row 12 — DE→FR B2B, service (the line carries `requires_shipping: false`, so the
mapper derives `supplyType: "services"`), buyer VAT-ID given. The table names category **AE** (§3a Abs. 2
UStG; Art. 44+196 VAT Directive) but flags that no official artifact example exists for this case, so the
category is not treated as decided: **the code refuses rather than guessing AE by analogy with row 3**.
`expected.json` still records `specCategory: "AE"` — the category the row names — separately from the
refusal on the build axis.

**Why the refusal is checked ahead of row 3 (K).** Apart from being a service, this order satisfies every
condition of the goods-only intra-EU branch — business buyer in another member state, buyer VAT-ID, a
positive VIES check — so without the supply-type distinction it would resolve to K. `decideVatCategory`
checks row 12's refusal first, and the refusal names the row's own rule. Resolving to AE automatically
instead would contradict that rule; row 13 is treated the same way. A merchant who has decided the fact
declares it with `regimeOverride: { kind: "reverse-charge-cross-border" }` — see
`row-12-eu-b2b-service-override`.

The `vat-id-evidence.json` fixture file is deliberately kept even though it doesn't decide this cell's
outcome — it proves the refusal comes from row 12's own rule, not from missing VIES evidence (the refusal
fires _before_ `vatIdEvidence` is even consulted).

- **Build axis**: expected **error**, `TaxRuleError` ("no official artifact example confirms a real
  validator accepts it").
- **Profile axis**: buyer country FR — expected **ok, `EN16931`**; France is an EU member state. The two
  axes are checked independently, so a profile-axis refusal could never hide the build-axis refusal.

No known bug: the build axis's refusal is the documented behaviour for this row while its category is not
decided.
