# row-08-zero-rated-photovoltaic

`docs/tax-semantics.md` row 8 — DE domestic B2B, photovoltaic installation (§12 Abs. 3 UStG, in force since
2023-01-01) — the only real German zero rate. Category should be **Z**, 0%. Added by T-133 (P-28 gap 3):
the original T-117 matrix explained why rows 10/11 are absent but said nothing about row 8, an unexplained
silence this cell closes.

**T-069 closed P-14.** `order.metadata.regime_override: { kind: "zero-rated" }` is now threaded through, so
`decideVatCategory`'s zero-rated branch is reachable through the real adapter — the same fix as rows 5/6.
This order's line (photovoltaic installation) is deliberately left `requires_shipping` unset (defaults to
goods): it's a real Werklieferung — equipment plus its installation, a single delivery of goods under §3
Abs. 6/7 UStG (the same Einheitlichkeit der Leistung doctrine behind D-50/P-33) — not the kind of "service"
`supplyType` derivation is meant to flag; it never reaches a `supplyType` branch anyway since `zero-rated`'s
override is checked first, ahead of every country/supply-type branch.

**Why this cell earns its place beyond "one more P-14 instance".** `BR-Z-10` is the only rule in this table
that runs in the opposite direction from E/AE/G/K: it **forbids** a BT-120/121 exemption reason on a Z line,
where every other non-standard category **requires** one. Every other cell in this matrix that exercises a
non-S category is therefore structurally unable to catch a regression that adds an exemption reason "just in
case" — this is now the one cell that actually does, category Z being live and real.

- **Build axis**: expected **ok**, category **Z**.
- **Profile axis**: DE buyer, no B2G reference — expected **ok**, `EN16931`.

No known bugs remaining on this cell.
