# b2g-order-reference-not-leitweg-id

A domestic B2B sale (`docs/tax-semantics.md` row 1) whose buyer keeps its own reference in
`customer.metadata.buyer_reference`: `2024-01`. That value has a Leitweg-ID's shape — two to twelve
digits, a hyphen, two check digits — but it is an ordinary reference, and its check digits do not add up.

This package used to infer a Leitweg-ID from BT-10's shape: this order was refused with
`InvalidLeitwegIdError`, and a reference whose check digits happened to add up was routed to XRechnung as a
public-sector buyer. A Leitweg-ID is now declared separately (`customer.metadata.leitweg_id`, see
`b2g-leitweg-id`); BT-10's free text is never read as one.

- **Build axis**: expected **ok, `S`**, with `2024-01` in BT-10 as it is.
- **Profile axis**: expected **ok, `EN16931`** — an ordinary B2B buyer.
