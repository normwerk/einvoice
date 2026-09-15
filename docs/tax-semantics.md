# Tax semantics — what the validator does not catch

> **Not tax advice.** This document lists the VAT rules `einvoice-commerce` applies — one scenario per row,
> each with its German/EU legal source and the EN 16931 business rules it triggers — so that you and your
> tax advisor can verify them against your situation. Every row is executable:
> [`packages/einvoice-commerce/src/tax-rules.ts`](../packages/einvoice-commerce/src/tax-rules.ts)
> (`decideVatCategory()`), one branch and one test per row. Where a rule cannot be decided generically, the
> software refuses and says why (see "What the validator does not catch"). Scope: Germany as seller
> country. All identifiers are synthetic.

## Why this document exists

L1–L3 validators (`AGENTS.md` §8) check that a VAT category is _structurally_ well-formed — the right fields
present, the right amounts computed. They cannot check that the category is the _correct_ one for a given
seller/buyer/supply combination — that is a judgment call encoded in `einvoice-commerce`
(`TaxContext` → `TaxDecision`, plan-v0.1 §4.4), and it is the one layer conformance tooling cannot grade
(`AGENTS.md` §8.5). This document exists to make that judgment explicit and reviewable, one scenario at a
time, before a single line of `einvoice-commerce` is written.

Scope: Germany only, matching v0.1 (`STRATEGY.md` §2). All identifiers below are synthetic
(`AGENTS.md` §5.2) — `DE 123456789` follows the convention already used by KoSIT's own XRechnung test suite
(vendored at
[`packages/einvoice-conformance/src/__fixtures__/kosit-testsuite-01.01a-INVOICE_ubl.xml`](../packages/einvoice-conformance/src/__fixtures__/kosit-testsuite-01.01a-INVOICE_ubl.xml)).

## Scenario table

One row = one scenario. `BR-*` references are verified against the vendored EN 16931 CII Schematron
(`artifacts/cii-d16b/schematron/EN16931-CII-validation-preprocessed.sch`, EUPL-1.2, spike A/T-013) — not
recalled from memory. `VATEX-*` codes are verified against the Peppol BIS 3.0 codelist documentation, which
cross-references the exact `BR-*-10` rule each code supports.

| #   | Scenario                              | Seller             | Buyer                             | Supply                                         | Regime                   | Category (BT-118)               | Rate (BT-119)                         | Exemption (BT-120/121)                                                                                                                                                                                   | Key mandatory fields                                                                                                                                                                                                                                                                                                                                                                                                                                           | Applicable BR-\*                                                                                       | Norm source                                                                                                                                                                                          |
| --- | ------------------------------------- | ------------------ | --------------------------------- | ---------------------------------------------- | ------------------------ | ------------------------------- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | DE → DE B2B, standard rate            | DE, `DE 123456789` | DE B2B, `DE 987654321`            | Consulting services                            | Domestic                 | **S**                           | 19%                                   | —                                                                                                                                                                                                        | Seller VAT-ID (BT-31)                                                                                                                                                                                                                                                                                                                                                                                                                                          | BR-S-01, BR-S-02, BR-S-08, BR-S-09                                                                     | UStG §12 Abs. 1                                                                                                                                                                                      |
| 2   | DE → DE B2B, reduced rate             | DE, `DE 123456789` | DE B2B, `DE 987654321`            | Books (Anlage 2 UStG)                          | Domestic                 | **S**                           | 7%                                    | —                                                                                                                                                                                                        | Seller VAT-ID (BT-31)                                                                                                                                                                                                                                                                                                                                                                                                                                          | Same BR-S-\* as #1 — EN 16931 has no separate category for a reduced rate, only a lower BT-119 under S | UStG §12 Abs. 2 Nr. 1 + Anlage 2                                                                                                                                                                     |
| 3   | DE → FR B2B, VAT-ID given             | DE, `DE 123456789` | FR B2B, `FR 12345678901`          | Goods, dispatched to FR                        | Intra-EU                 | **K**                           | 0%                                    | BT-121 `VATEX-EU-IC` ("Intra-Community supply")                                                                                                                                                          | Seller VAT-ID (BT-31, BR-IC-02); Actual delivery date (BT-72) or Invoicing period (BG-14) (BR-IC-11); Deliver-to country code (BT-80) (BR-IC-12)                                                                                                                                                                                                                                                                                                               | BR-IC-01, -02, -05, -08, -09, -10, -11, -12                                                            | UStG §4 Nr. 1b + §6a (intra-Community supply); Art. 138 VAT Directive                                                                                                                                |
| 4   | DE → CH (non-EU)                      | DE, `DE 123456789` | CH, `CHE-123.456.789 MWST`        | Goods, exported to CH                          | Export                   | **G**                           | 0%                                    | BT-121 `VATEX-EU-G` ("Export outside the EU")                                                                                                                                                            | — (no seller-VAT-ID rule fires for G the way it does for K/AE)                                                                                                                                                                                                                                                                                                                                                                                                 | BR-G-01, -05 (analogue), -08, -09, -10                                                                 | UStG §4 Nr. 1a + §6 (export supply)                                                                                                                                                                  |
| 5   | DE → DE B2B, reverse charge service   | DE, `DE 123456789` | DE B2B, `DE 987654321`            | Construction/subcontractor service (§13b UStG) | Domestic, reverse charge | **AE**                          | 0%                                    | BT-121 `VATEX-EU-AE` ("Reverse charge") — **mandatory**, BR-AE-10                                                                                                                                        | Seller VAT-ID (BT-31, BR-AE-02)                                                                                                                                                                                                                                                                                                                                                                                                                                | BR-AE-01, -02, -08, -09, -10                                                                           | UStG §13b                                                                                                                                                                                            |
| 6   | DE domestic, exempt supply            | DE, `DE 123456789` | DE, B2B or B2C                    | e.g. medical/educational service under §4 UStG | Domestic, exempt         | **E**                           | 0%                                    | BT-120 free text naming the §4 UStG exemption (no single universal `VATEX-*` code — the exact EU directive article varies by exemption type; ⚠️ needs expert confirmation per case) — mandatory, BR-E-10 | —                                                                                                                                                                                                                                                                                                                                                                                                                                                              | BR-E-01, -08, -09, -10                                                                                 | UStG §4 (various numbers)                                                                                                                                                                            |
| 7   | DE → EU B2C, distance sale (OSS)      | DE, `DE 123456789` | Another EU state, B2C (no VAT-ID) | Goods, distance sale                           | OSS one-stop-shop        | **S**                           | _buyer's country_ rate, not Germany's | —                                                                                                                                                                                                        | —                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Same BR-S-\* as #1                                                                                     | Art. 33 VAT Directive; ⚠️ outside the DE B2B/B2G mandate this project targets, but occurs in mixed merchant catalogs — rate is supplied by the caller (`ossRateOverride`), not derived automatically |
| 8   | Zero-rated domestic supply            | DE, `DE 123456789` | DE B2B                            | Rare domestic zero-rate case                   | Domestic                 | **Z**                           | 0%                                    | BR-Z-10 explicitly **forbids** a BT-120/121 exemption text/code on a Z line (unlike E/AE/G/K/IC)                                                                                                         | —                                                                                                                                                                                                                                                                                                                                                                                                                                                              | BR-Z-01, -08, -09, -10                                                                                 | Rare in DE; kept for completeness of code coverage                                                                                                                                                   |
| 9   | Mixed rates on one invoice            | DE, `DE 123456789` | DE B2B                            | Goods at 19% + books at 7%                     | Domestic, two rates      | **S** (twice, different BT-119) | 19% and 7%                            | —                                                                                                                                                                                                        | Two `BG-23` VAT breakdown groups, one per rate                                                                                                                                                                                                                                                                                                                                                                                                                 | BR-S-08, BR-S-09 (per breakdown), BR-CO-15, BR-CO-17 (totals)                                          | UStG §12, mixed basket                                                                                                                                                                               |
| 10  | Credit note for a return              | DE, `DE 123456789` | DE B2B                            | Full or partial return of #1                   | Domestic, correction     | **S**                           | 19%                                   | —                                                                                                                                                                                                        | Document type code 381 (`BR-CL-01`); **not** structurally required, but should carry `BT-25` (Preceding Invoice reference) — `BR-55` only fires if BG-3 is present at all, so a credit note _without_ any preceding-invoice reference still validates. This is exactly the kind of gap this document is for.                                                                                                                                                   | BR-S-\* (same as #1), BR-55 (conditional)                                                              | —                                                                                                                                                                                                    |
| 11  | Corrected invoice (not a credit note) | DE, `DE 123456789` | DE B2B                            | #1 re-issued with a corrected amount/field     | Domestic, correction     | **S**                           | 19%                                   | —                                                                                                                                                                                                        | Document type code **384** (`BR-DE-17`, XRechnung-specific — not one of EN 16931's own two base codes, 380/381); `BT-25` **recommended** (`BR-DE-26`, `flag="warning"` — confirmed empirically: `valid: false`, `accepted: true`, see below) when 384 is used — same non-enforcement pattern as row 10's `BR-55`, on a document our own `einvoice-commerce` does not support yet (`CommerceInvoiceInput.document.kind` is only `"invoice"` or `"credit-note"`) | BR-DE-17, BR-DE-26 (both `warning`, not `fatal`)                                                       | UNTDID 1001 (via `BR-DE-17`'s own code list: 326/380/384/389/381/875/876/877)                                                                                                                        |

## What the validator does not catch (so far)

Concrete gaps found while building this table, each traceable to a rule (or the absence of one) above:

- **Buyer VAT-ID for intra-community supply (row 3) is not enforced by the base EN 16931 Schematron.**
  `BR-IC-02` only requires the _seller's_ VAT-ID. The Art. 138 exemption is fiscally only valid with a
  _valid buyer_ VAT-ID recorded in VIES — `einvoice-commerce` must require and ideally check BT-48 itself;
  a green validator here proves nothing about the exemption's actual validity.
- **Profile choice is the recipient's expectation, not the buyer's country as a gate (P-05, T-066).** A
  German seller invoicing a French or Dutch business (rows 3–4) needs no national CIUS of the buyer's
  country: the EN 16931 hybrid (Factur-X = ZUGFeRD `EN 16931`) is accepted EU-wide. Only clearance-model
  countries (IT SDI, PL KSeF) cannot be served by any EN 16931 document at all — those are refused
  explicitly, not silently. Seller-side jurisdiction (tax rules) stays DE-only until v0.2.
- **A credit note is never structurally forced to reference the invoice it corrects (row 10).** `BR-55`
  only requires `BT-25` to be non-empty _if_ a preceding-invoice-reference group is present at all — it
  never requires the group itself. `einvoice-commerce`'s credit-note path must make BT-25 mandatory by its
  own rule, not rely on the validator.
- **Category E (exempt, row 6) has no single universal exemption code.** Unlike K/AE/G (each with one
  fixed `VATEX-*` code tied 1:1 to a `BR-*-10` rule), which specific UStG §4 exemption applies is a
  case-by-case legal judgment `einvoice-commerce` cannot resolve generically — the caller supplies the
  exemption reason, and the software refuses to guess.
- **OSS distance sales (row 7) use the same category S as a domestic sale**, just with a different rate —
  nothing in the EN 16931 rule set signals that the rate came from OSS logic rather than a plain domestic
  rate. Getting the _rate lookup_ wrong (using DE's 19% instead of the buyer country's rate) produces a
  document that validates perfectly and is still wrong.
- **A reduced rate (row 2) is just a lower percentage inside the same category S.** Nothing distinguishes
  "we deliberately applied 7% because this is a book" from "we made an arithmetic mistake and typed 7
  instead of 19" — `TaxDecision.reasoning` (plan-v0.1 §4.4) is the only place this becomes auditable.
- **A Leitweg-ID's own check digit is never validated by KoSIT.** `BR-DE-15` (verified against the real
  rule text in the built KoSIT Docker image, not recalled) only requires `BT-10` (Buyer reference) to be
  non-empty — it has no opinion on whether the value is a well-formed Leitweg-ID at all. A mistyped
  Leitweg-ID (right shape, wrong check digit — or simply a typo that produces a different but still
  plausible-looking German public-sector routing address) passes KoSIT cleanly and only fails once it
  reaches the receiving system and misroutes. `einvoice-commerce` closes this specific gap itself
  (`leitweg-id.ts`, T-062) — not because KoSIT asked it to, but because KoSIT structurally cannot: the real
  ISO/IEC 7064 MOD 97-10 checksum is outside EN 16931's own rule vocabulary entirely, it's a German
  national convention layered on top of BT-10.
- **Invoice number uniqueness and gap-free sequencing are never checked by any single-document validator.**
  `BR-02` (verified the same way) only requires `BT-1` to be non-empty — any string satisfies it, including
  a duplicate of an already-issued number or one that skips ten values. This isn't a EN 16931 oversight;
  it's structurally out of reach for a schematron that validates one document at a time and never sees the
  others. Germany's own bookkeeping law (GoBD) requires gap-free sequential numbering, but nothing in the
  XRechnung/KoSIT toolchain enforces it — `einvoice-commerce`'s `numbering.ts` (T-063) is the only place in
  this codebase that even attempts to guarantee it, and only for numbers this package itself allocates
  (`SequentialNumberer`); a caller-supplied `document.number` is trusted as-is.
- **A credit note (381) and a corrected invoice (384) are two different EN 16931/XRechnung document types
  with almost the same non-enforcement pattern, and `einvoice-commerce` only implements one of them
  (row 11).** `BR-DE-26` (also verified against the real rule text — and, like `BR-DE-17`, only a
  `flag="warning"`, not `fatal`) recommends but does not require `BT-25` when code 384 is used, mirroring
  row 10's `BR-55` gap for credit notes almost exactly. The two codes are not interchangeable in practice —
  381 is a new financial document (a return, a rebate) that stands on its own; 384 replaces or amends a
  previously issued invoice's content. `CommerceInvoiceInput.document.kind` (`"invoice" | "credit-note"`)
  has no way to express the 384 case at all yet — a real, documented gap, not a silent omission.
- **"KoSIT accepted it" and "the report's `valid` attribute is `true`" are not the same claim, and this
  repo's own tooling only checked the second one until now.** Confirmed by actually running the row-11
  document (code 384, no `BT-25`) through the real KoSIT validator: the report's own
  `<rep:report valid="…">` attribute is `false` (any `warning`-level message flips it, not only `fatal`
  ones), yet `<rep:assessment><rep:accept>` and the CLI's own human-readable "Acceptable: 1, Rejected: 0"
  both say the document is fine to process. Every conformance gate in this repo (`pnpm conformance:fixtures`
  and friends) asserts the strict `valid` field, deliberately — a document with an unaddressed warning does
  not count as "green" here even if KoSIT itself would forward it — but until this was found, our own
  `einvoice-conformance` package could not even report the distinction: `parseKositReport()` now exposes it
  as a separate `accepted` field (`kosit-report.ts`) rather than silently equating "valid" with "accepted".
- **The word "Gutschrift" is ambiguous in German VAT law (P-04, T-034).** UStG §14 Abs. 2 uses _Gutschrift_
  for a _self-billed invoice_ (UNTDID 1001 code 389, issued by the buyer). A credit note (381) whose
  human-readable title says "Gutschrift" can be misread as self-billing, with §14c exposure. The XML is
  unambiguous (type code 381); the PDF title is not. `einvoice-pdfa` therefore titles 381 documents
  "Rechnungskorrektur", never "Gutschrift" — the exact wording is chosen conservatively (BMF-Schreiben 2013
  does permit "Gutschrift" in an unambiguous context, but common practice avoids it); confirm the final
  phrasing with your own tax advisor before relying on it.

This list is a starting point, not exhaustive — it grows as scenarios are added.

## DK/NO/SE identifiers (out of v0.1 scope — documented, not implemented)

T-052 asks this document to at least name what v0.1 deliberately does not cover, rather than leave the gap
silent. v0.1 targets Germany only (`STRATEGY.md` §2); `einvoice-commerce`'s `selectProfile()` (T-065)
refuses a non-German buyer country outright rather than guessing a profile for it, and `decideVatCategory()`
(T-061) refuses a non-German seller the same way (`tax-rules.ts`).

Denmark, Norway, and Sweden each use their own national business-registry identifier as the Peppol
participant-ID scheme, already present in this repo's own vendored `EasCode` codelist (`BT-34`/`BT-49`
electronic address scheme, sourced from the EN 16931 CII Schematron's `BR-CL-25`) even though nothing yet
maps a DK/NO/SE party to one — confirmed directly against the [official Peppol ICD code list](https://docs.peppol.eu/poacc/billing/3.0/codelist/ICD/),
not assumed from the code values alone:

| Country | ICD code | Scheme name (verbatim from the Peppol registry)                                  |
| ------- | -------- | -------------------------------------------------------------------------------- |
| Denmark | `0184`   | DIGSTORG (Danish CVR-registered companies, incl. legal persons and associations) |
| Norway  | `0192`   | Organisasjonsnummer (Central Coordinating Register for Legal Entities)           |
| Sweden  | `0007`   | Organisationsnummer (issued by the Swedish National Tax Board)                   |

Norway's own B2B e-invoicing mandate takes effect 2027-01-01 (verified separately for this project's own
market research, not re-derived here). Denmark's and Sweden's mandate specifics have not been researched for
this repository — recorded honestly as unresearched, not guessed, pending whatever triggers v0.2 scope.
