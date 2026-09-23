# de-credit-note

Credit note (document type code 381) for a full return of [`de-b2b-standard`](../de-b2b-standard/), same
seller/buyer, same VAT category. Corresponds to row 10 of
[`docs/tax-semantics.md`](../../docs/tax-semantics.md).

- **Category:** S (Standard rated), 19% — same as the invoice it corrects; a credit note does not change
  the VAT category, only the document type code and the reference back to the original
- **Document type code:** 381 (`BR-CL-01`)
- **Reference to the original invoice:** `precedingInvoiceReferences[0]` (BT-25 `RE-2026-0001`, BT-26
  `2026-09-13`) — see `docs/tax-semantics.md` for why this is **not** structurally required (`BR-55` only
  fires if the group is present at all; nothing forces a credit note to carry it)
- **Levels:** L1+L2 verified against the real KoSIT validator (`pnpm conformance:fixtures`); L4 and L5 as
  described in [`fixtures/README.md`](../README.md).

`expected/` stays empty: this fixture is checked live against the validators rather than compared to a
committed golden CII XML.
