# row-05-reverse-charge

`docs/tax-semantics.md` row 5 — DE→DE B2B, reverse charge (§13b UStG, subcontracted construction work).
Category should be **AE**, 0%, with the mandatory `VATEX-EU-AE` text "Steuerschuldnerschaft des
Leistungsempfängers" (`BR-AE-02` also requires both parties' VAT-ID/legal-registration identifier).

`decideVatCategory`'s AE branch is _only_ reachable via an explicit `regimeOverride: { kind:
"reverse-charge" }` — there is no automatic derivation (which supplies are §13b-eligible is a case-by-case
fact `TaxContext` cannot express on its own). **`MapOrderOptions` has no `regimeOverride` field at all**
(`order-to-commerce-invoice-input.ts`), so the adapter can never construct one — this doubles as the "AE
without override" mandatory-rejection case, for the same reason row 3 doubles as "K without evidence": there
is no synthetic order shape that could reach AE _with_ an override through today's real adapter.

Unlike row 3, this does **not** throw — the buyer is DE, so with no override the request silently falls
through to the ordinary domestic branch and resolves to category **S**. A merchant relying on this plugin
for real §13b reverse-charge construction invoices would get a wrong, but fully valid-looking, invoice with
no error at all — the sharpest form of "58 green tests coexisting with a broken scenario" this matrix exists
to surface, since (unlike rows 3/4/7/12/13) nothing here is blocked by P-13 either: both axes report success,
just the wrong one.

- **Build axis**: expected **"ok", category S** (spec says AE) — known bug **P-14** (`regimeOverride` never
  threaded through, `packages/einvoice-medusa/src/mapping/order-to-commerce-invoice-input.ts`).
- **Profile axis**: DE buyer, no B2G reference — expected **green**, `EN16931` (correct — P-13 doesn't apply
  here, the buyer is German).

Known bug: **P-14** (build axis only — this is the one backbone row where the profile axis is genuinely
fine and the category axis is genuinely, silently wrong).

**Not yet checked, masked by P-14 the same way P-19 is masked on row 3:** `BR-AE-02` needs the buyer's
VAT-ID/legal-registration identifier too, not just the seller's (`docs/domain-glossary.md`'s existing
bullet) — `build-invoice.ts` has a guard for K's equivalent (`BR-IC-11`/`BR-IC-12`) but the P-19 queue entry
(`ecom docs/plan-v0.1-pending.md`) already flags that no analogous guard exists for AE either. This cell
can't demonstrate that live today, because category AE is never actually reached — once T-069 threads
`regimeOverride` through, re-run this cell; if it doesn't turn fully green, that guard gap is why.
