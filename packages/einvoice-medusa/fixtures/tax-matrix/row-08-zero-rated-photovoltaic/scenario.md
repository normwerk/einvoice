# row-08-zero-rated-photovoltaic

`docs/tax-semantics.md` row 8 — DE domestic B2B, photovoltaic installation (§12 Abs. 3 UStG, in force since
2023-01-01) — the only real German zero rate. Category should be **Z**, 0%. This cell keeps row 8 from being
silently absent from the matrix.

`order.metadata.regime_override: { kind: "zero-rated" }` is carried through by the mapper, so
`decideVatCategory`'s zero-rated branch is reached through the real adapter — the same mechanism as rows 5/6.
This order's line (photovoltaic installation) is deliberately left `requires_shipping` unset (defaults to
goods): it's a real Werklieferung — equipment plus its installation, a single delivery of goods under §3
Abs. 6/7 UStG (the Einheitlichkeit der Leistung doctrine) — not the kind of "service" `supplyType`
derivation is meant to flag. It never reaches a `supplyType` branch anyway: the `zero-rated` override is
checked ahead of every country/supply-type branch.

**Why this cell matters beyond showing the override reaches the engine.** `BR-Z-10` is the only rule in
this table that runs in the opposite direction from E/AE/G/K: it **forbids** a BT-120/121 exemption reason
on a Z line, where every other non-standard category **requires** one. Every other cell in this matrix that
exercises a non-S category is therefore structurally unable to catch a regression that adds an exemption
reason "just in case" — this cell's KoSIT run in the Docker gate is the one that does.

- **Build axis**: expected **ok**, category **Z**.
- **Profile axis**: DE buyer, no B2G reference — expected **ok**, `EN16931`.

No known bug involved.
