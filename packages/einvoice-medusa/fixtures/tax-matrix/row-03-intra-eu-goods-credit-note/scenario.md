# row-03-intra-eu-goods-credit-note

Credit note pairing for `row-03-intra-eu-goods` — a return of an intra-EU supply, own `selectProfile`
call site (`credit-note-on-payment-refunded.ts`). Same root causes as the invoice cell; a return doesn't
change what evidence the adapter can supply (still none).

Known bugs: **P-12** (build axis), **P-13** (profile axis).
