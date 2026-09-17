# row-03-intra-eu-goods

`docs/tax-semantics.md` row 3 — DE→FR B2B, buyer VAT-ID given (goods). Category **K**, 0%
(`VATEX-EU-IC`, `§4 Nr. 1b, §6a UStG`). Buyer VAT-ID is present (`customer.metadata.vat_id`, this plugin's
own convention), so `decideVatCategory`'s intra-EU branch condition is structurally met — but it also
requires `vatIdEvidence.status === "valid"` (a positive VIES check) or an explicit
`regimeOverride: { kind: "intra-eu-confirmed" }`, and **the adapter has no way to supply either** —
`EinvoiceModuleOptions` has no `VatIdVerifier` field, and the subscribers never populate
`BuildInvoiceOptions.vatIdEvidence` (T-079 is the task that adds this wiring). There is also no field on
`MapOrderOptions`/`MedusaOrderForInvoice` for a `regimeOverride` at all (T-069). This cell therefore doubles
as the "K without evidence" mandatory-rejection case — there is no synthetic order shape that could reach K
_with_ evidence through today's real adapter, so a separate rejection fixture would be redundant.

- **Build axis**: expected **error**, `TaxRuleError` ("needs a positive VIES check"). Known bug **P-12**
  (VAT-ID verification not wired into the adapter).
- **Profile axis**: buyer country FR ≠ DE — expected **error**, `UnsupportedCountryError`. Known bug
  **P-13**. In the real subscriber pipeline this fires _first_, before `buildInvoice` is ever called.

**The full masking chain, three bugs deep** — none of P-12/P-25/P-19 is directly observable via a live run
today, only by direct code inspection, because each is blocked by the one before it: P-13 (profile) masks
P-12 (no VAT-ID evidence path); fixing P-12 alone would then hit **P-25** (`delivery`/BG-13 never mapped —
`buildInvoice`'s own `MissingDeliveryInfoForIntraCommunitySupplyError` guard, `BR-IC-11`/`BR-IC-12`); fixing
P-25 too would _then_ reach **P-19** — `build-invoice.ts` has no guard for `BR-IC-02` (buyer VAT-ID, BT-48,
`flag="fatal"`) at the point it checks category K, unlike the neighbouring BR-IC-11/12 guard right next to
it (confirmed by direct code read, not inferred) — so the first fully-mapped, evidence-and-delivery-complete
K-category attempt would still get a **fatal real KoSIT rejection**, not a clean pass. T-079's own acceptance
criterion is exactly this cell going green; each fix should be re-run against this same cell rather than a
new one, since the cell's spec expectation (category K) was already correct from the first run.

Known bugs: **P-12** (build axis, proximate), **P-13** (profile axis), **P-25** and **P-19** (confirmed by
code inspection, not yet triggerable by any live fixture until P-12/P-13 are fixed first).
