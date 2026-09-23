/**
 * Curated EN 16931 BT/BG term list — the input `generate.mjs` turns into
 * `packages/einvoice-model/src/generated/*.ts`.
 *
 * Every entry's `source` names exactly which rule (in the vendored,
 * EUPL-1.2 `artifacts/cii-d16b/schematron/EN16931-CII-validation-preprocessed.sch`)
 * proves its BT/BG-number-to-name mapping. `generate.mjs` checks every
 * `verified: "extraction"` entry's `name` against
 * `extract-term-names.mjs`'s output for that code and refuses to generate
 * if they disagree — this file cannot silently drift from the artifact.
 *
 * COVERAGE (2026-09-13, first pass): this is not all ~155 BT / ~35 BG terms
 * EN 16931 defines — see `docs/mapping-reference.md` note at the bottom of
 * `generate.mjs`'s output for exactly what's missing and why. It is every
 * term with its own explicit business rule in the base EN 16931 CII
 * Schematron, which — per plan-v0.1 §1 principle 3 ("one vertical, then
 * width") — is enough to model a complete domestic/intra-EU/export/reverse-
 * charge/exempt invoice or credit note (the 10 scenarios in
 * `docs/tax-semantics.md`). Full postal addresses were left out of the
 * first pass: their BT numbers are not asserted by name in any rule we can
 * quote directly, and a Peppol summary had turned out factually **wrong**
 * for a neighboring field (BT-40/41 mixed up), so unverifiable numbers were
 * excluded rather than guessed. City and post code came in later through
 * the XRechnung rules that name them (BT-37/38, BT-52/53, BT-77/78); the
 * first two address lines of each address (BT-35/36, BT-50/51, BT-75/76,
 * P-60 — §14 Abs. 4 Nr. 1 UStG needs the full address) through the
 * "e-invoice-eu-schema" tier below, each cross-checked against its own
 * docs.peppol.eu element page. Address line 3, country subdivision and PO
 * box are still out.
 *
 * `verified` values:
 *  - "extraction": name is asserted, byte for byte, in the vendored
 *    Schematron's own rule text (cross-checked automatically).
 *  - "well-known": the BG's existence/number is standard EN 16931
 *    terminology used identically across every public implementation guide
 *    (Peppol, KoSIT, ConnectingEurope) — not independently phrased as
 *    "the X (BG-N)" in our vendored rule text, so not cross-checked, but
 *    not something we invented either.
 *  - "kosit-xrechnung": name is asserted, quoted verbatim in `source`, in
 *    the KoSIT `validator-configuration-xrechnung` bundle (Apache-2.0,
 *    `artifacts/MANIFEST.json` id `xrechnung-validator-configuration`) —
 *    not the ConnectingEurope Schematron `extract-term-names.mjs` checks
 *    against, so not run through that automatic cross-check, but still a
 *    direct quote from a real, licensed artifact, not memory. These are
 *    fields the DE XRechnung profile (or KoSIT's bundled Peppol-derived
 *    EN 16931 rules) requires beyond the base ConnectingEurope ruleset —
 *    found by running our own serializer output through the real KoSIT
 *    Docker validator (T-021) and reading the rejection.
 *  - "e-invoice-eu-schema": name is asserted, quoted verbatim in `source`,
 *    as the `title` of that BT's field in `@e-invoice-eu/core`'s own
 *    embedded EN 16931 JSON Schema (WTFPL, already a pinned root
 *    devDependency used elsewhere in this repo as a differential oracle,
 *    T-041/D-21 — `node_modules/@e-invoice-eu/core/dist/e-invoice-eu.esm.js`,
 *    grep for the BT id). Used only for a BT that genuinely has no
 *    business rule anywhere in the vendored ConnectingEurope Schematron
 *    (confirmed absent by grepping both `.sch` files for the BT id before
 *    reaching for this — not a first resort), so "extraction" cannot apply
 *    at all. Cross-checked against a second, independent source before
 *    trusting it: docs.peppol.eu's own per-element documentation page for
 *    the same BT carries the identical description sentence, word for
 *    word — not just a similar paraphrase — which is why this tier exists
 *    as a distinct, narrower claim than "well-known" (that tier is *not*
 *    independently phrase-checked at all; this one is, just against an
 *    artifact other than our own vendored Schematron).
 */

/**
 * @typedef {Object} TermDef
 * @property {string} id - "BT-27" or "BG-4"
 * @property {string} name - official term name
 * @property {"BT" | "BG"} kind
 * @property {string} tsType - TS type this field/group maps to
 * @property {boolean} required
 * @property {boolean} repeats - true if this is an array (BG only, mostly)
 * @property {string} group - which generated interface this field belongs to
 * @property {"extraction" | "well-known" | "kosit-xrechnung" | "e-invoice-eu-schema"} verified
 * @property {string} source - rule id (e.g. "BR-27") or a short note
 */

/** @type {TermDef[]} */
export const terms = [
  // --- Root invoice/credit-note header ---
  {
    id: "BT-1",
    name: "Invoice number",
    kind: "BT",
    tsType: "string",
    required: true,
    repeats: false,
    group: "Invoice",
    verified: "extraction",
    source: "BR-1",
  },
  {
    id: "BT-2",
    name: "Invoice issue date",
    kind: "BT",
    tsType: "IsoDate",
    required: true,
    repeats: false,
    group: "Invoice",
    verified: "extraction",
    source: "BR-2",
  },
  {
    id: "BT-3",
    name: "Invoice type code",
    kind: "BT",
    tsType: "InvoiceTypeCode",
    required: true,
    repeats: false,
    group: "Invoice",
    verified: "extraction",
    source: "BR-3",
  },
  {
    id: "BT-5",
    name: "Invoice currency code",
    kind: "BT",
    tsType: "CurrencyCode",
    required: true,
    repeats: false,
    group: "Invoice",
    verified: "extraction",
    source: "BR-5",
  },
  {
    id: "BT-6",
    name: "VAT accounting currency code",
    kind: "BT",
    tsType: "CurrencyCode",
    required: false,
    repeats: false,
    group: "Invoice",
    verified: "extraction",
    source: "BR-6",
  },
  {
    id: "BT-7",
    name: "Value added tax point date",
    kind: "BT",
    tsType: "IsoDate",
    required: false,
    repeats: false,
    group: "Invoice",
    verified: "extraction",
    source: "text near BT-7",
  },
  {
    id: "BT-8",
    name: "Value added tax point date code",
    kind: "BT",
    tsType: "string",
    required: false,
    repeats: false,
    group: "Invoice",
    verified: "extraction",
    source: "text near BT-8",
  },
  {
    id: "BT-24",
    name: "Specification identifier",
    kind: "BT",
    tsType: "string",
    required: true,
    repeats: false,
    group: "Invoice",
    verified: "extraction",
    source: "BR-24",
  },
  {
    id: "BT-10",
    name: "Buyer reference",
    kind: "BT",
    tsType: "string",
    required: false,
    repeats: false,
    group: "Invoice",
    verified: "well-known",
    source:
      "not asserted by name in the base EN 16931 Schematron (it's optional there) — read directly in the XRechnung-specific layer (KoSIT validator-configuration-xrechnung, Apache-2.0, XRechnung-CII-validation.xsl, rule BR-DE-15: 'Das Element \"Buyer reference\" (BT-10) muss übermittelt werden.'), which mandates it for the DE CIUS profile",
  },

  // --- BG-3 Preceding invoice reference (credit notes) ---
  {
    id: "BG-3",
    name: "Preceding Invoice reference",
    kind: "BG",
    tsType: "PrecedingInvoiceReference",
    required: false,
    repeats: true,
    group: "Invoice",
    verified: "extraction",
    source: "BR-55 context",
  },
  {
    id: "BT-25",
    name: "Preceding Invoice reference",
    kind: "BT",
    tsType: "string",
    required: true,
    repeats: false,
    group: "PrecedingInvoiceReference",
    verified: "extraction",
    source: "BR-55",
  },
  {
    id: "BT-26",
    name: "Preceding Invoice issue date",
    kind: "BT",
    tsType: "IsoDate",
    required: false,
    repeats: false,
    group: "PrecedingInvoiceReference",
    verified: "well-known",
    source: "standard BG-3 sibling of BT-25, not independently quoted by name in our extraction",
  },

  // --- BG-4 Seller ---
  {
    id: "BG-4",
    name: "Seller",
    kind: "BG",
    tsType: "SellerParty",
    required: true,
    repeats: false,
    group: "Invoice",
    verified: "extraction",
    source: "BR-6 context",
  },
  {
    id: "BT-27",
    name: "Seller name",
    kind: "BT",
    tsType: "string",
    required: true,
    repeats: false,
    group: "SellerParty",
    verified: "extraction",
    source: "BR-27",
  },
  {
    id: "BT-29",
    name: "Seller identifier",
    kind: "BT",
    tsType: "string",
    required: false,
    repeats: false,
    group: "SellerParty",
    verified: "extraction",
    source: "text near BT-29",
  },
  {
    id: "BT-30",
    name: "Seller legal registration identifier",
    kind: "BT",
    tsType: "string",
    required: false,
    repeats: false,
    group: "SellerParty",
    verified: "extraction",
    source: "BR-CO-26",
  },
  {
    id: "BT-31",
    name: "Seller VAT identifier",
    kind: "BT",
    tsType: "string",
    required: false,
    repeats: false,
    group: "SellerParty",
    verified: "extraction",
    source: "BR-S-02/BR-AE-02/BR-IC-02",
  },
  {
    id: "BT-32",
    name: "Seller tax registration identifier",
    kind: "BT",
    tsType: "string",
    required: false,
    repeats: false,
    group: "SellerParty",
    verified: "extraction",
    source: "text near BT-32",
  },
  {
    id: "BT-40",
    name: "Seller country code",
    kind: "BT",
    tsType: "CountryCode",
    required: true,
    repeats: false,
    group: "SellerParty",
    verified: "extraction",
    source: "BR-09",
  },

  // --- BG-11 Seller tax representative ---
  {
    id: "BG-11",
    name: "Seller tax representative party",
    kind: "BG",
    tsType: "TaxRepresentativeParty",
    required: false,
    repeats: false,
    group: "Invoice",
    verified: "extraction",
    source: "text near BG-11",
  },
  {
    // T-093: found missing by the L4 differential oracle (T-041,
    // tools/conformance/oracle-e-invoice-eu.mjs) — @e-invoice-eu/core's UBL
    // binding requires a party name for the tax representative and our
    // model had none, so the oracle mapper had to refuse rather than emit
    // an incomplete party. BR-18 (artifacts/cii-d16b/schematron/
    // EN16931-CII-validation-preprocessed.sch) is the real source, quoted
    // verbatim below — not recalled from memory.
    id: "BT-62",
    name: "Seller tax representative name",
    kind: "BT",
    tsType: "string",
    required: true,
    repeats: false,
    group: "TaxRepresentativeParty",
    verified: "extraction",
    source: "BR-18",
  },
  {
    id: "BT-63",
    name: "Seller tax representative VAT identifier",
    kind: "BT",
    tsType: "string",
    required: true,
    repeats: false,
    group: "TaxRepresentativeParty",
    verified: "extraction",
    source: "text near BT-63",
  },
  {
    id: "BT-69",
    name: "Tax representative country code",
    kind: "BT",
    tsType: "CountryCode",
    required: true,
    repeats: false,
    group: "TaxRepresentativeParty",
    verified: "extraction",
    source: "text near BT-69",
  },

  // --- BG-7 Buyer (number is standard EN 16931 terminology; our extraction
  // confirms every individual field below by name, just not "Buyer (BG-7)"
  // as one quoted phrase) ---
  {
    id: "BG-7",
    name: "Buyer",
    kind: "BG",
    tsType: "BuyerParty",
    required: true,
    repeats: false,
    group: "Invoice",
    verified: "well-known",
    source: "standard EN 16931 group number for the buyer party",
  },
  {
    id: "BT-44",
    name: "Buyer name",
    kind: "BT",
    tsType: "string",
    required: true,
    repeats: false,
    group: "BuyerParty",
    verified: "extraction",
    source: "text near BT-44",
  },
  {
    id: "BT-47",
    name: "Buyer legal registration identifier",
    kind: "BT",
    tsType: "string",
    required: false,
    repeats: false,
    group: "BuyerParty",
    verified: "extraction",
    source: "text near BT-47",
  },
  {
    id: "BT-48",
    name: "Buyer VAT identifier",
    kind: "BT",
    tsType: "string",
    required: false,
    repeats: false,
    group: "BuyerParty",
    verified: "extraction",
    source: "text near BT-48",
  },
  {
    id: "BT-55",
    name: "Buyer country code",
    kind: "BT",
    tsType: "CountryCode",
    required: true,
    repeats: false,
    group: "BuyerParty",
    verified: "extraction",
    source: "text near BT-55",
  },

  // --- BG-13 Delivery information (standard number) ---
  {
    id: "BG-13",
    name: "Delivery information",
    kind: "BG",
    tsType: "Delivery",
    required: false,
    repeats: false,
    group: "Invoice",
    verified: "well-known",
    source: "standard EN 16931 group number for delivery information",
  },
  {
    id: "BT-72",
    name: "Actual delivery date",
    kind: "BT",
    tsType: "IsoDate",
    required: false,
    repeats: false,
    group: "Delivery",
    verified: "extraction",
    source: "BR-IC-11",
  },
  {
    id: "BT-80",
    name: "Deliver to country code",
    kind: "BT",
    tsType: "CountryCode",
    required: false,
    repeats: false,
    group: "Delivery",
    verified: "extraction",
    source: "BR-IC-12",
  },

  // --- BG-14 Invoicing period ---
  {
    id: "BG-14",
    name: "Invoicing period",
    kind: "BG",
    tsType: "InvoicingPeriod",
    required: false,
    repeats: false,
    group: "Invoice",
    verified: "extraction",
    source: "BR-IC-11",
  },
  {
    id: "BT-73",
    name: "Invoicing period start date",
    kind: "BT",
    tsType: "IsoDate",
    required: false,
    repeats: false,
    group: "InvoicingPeriod",
    verified: "extraction",
    source: "text near BT-73",
  },
  {
    id: "BT-74",
    name: "Invoicing period end date",
    kind: "BT",
    tsType: "IsoDate",
    required: false,
    repeats: false,
    group: "InvoicingPeriod",
    verified: "extraction",
    source: "text near BT-74",
  },

  // --- BG-16 Payment instructions ---
  {
    id: "BG-16",
    name: "Payment instruction",
    kind: "BG",
    tsType: "PaymentInstructions",
    required: false,
    repeats: false,
    group: "Invoice",
    verified: "extraction",
    source: "BR-49",
  },
  {
    id: "BT-81",
    name: "Payment means type code",
    kind: "BT",
    tsType: "PaymentMeansCode",
    // BR-49: "A Payment instruction (BG-16) shall specify the Payment means type code (BT-81)" — required
    // within BG-16 (which itself stays optional). Was `false`, so `paymentInstructions: {}` type-checked
    // and serialized to an empty SpecifiedTradeSettlementPaymentMeans (P-43).
    required: true,
    repeats: false,
    group: "PaymentInstructions",
    verified: "extraction",
    source: "text near BT-81",
  },
  {
    id: "BT-84",
    name: "Payment account identifier",
    kind: "BT",
    tsType: "string",
    required: false,
    repeats: false,
    group: "PaymentInstructions",
    verified: "extraction",
    source: "text near BT-84",
  },

  // --- BG-20 Document level allowance ---
  {
    id: "BG-20",
    name: "Document level allowance",
    kind: "BG",
    tsType: "DocumentLevelAllowance",
    required: false,
    repeats: true,
    group: "Invoice",
    verified: "extraction",
    source: "BR-IC-03",
  },
  {
    id: "BT-92",
    name: "Document level allowance amount",
    kind: "BT",
    tsType: "Amount",
    required: true,
    repeats: false,
    group: "DocumentLevelAllowance",
    verified: "extraction",
    source: "text near BT-92",
  },
  {
    id: "BT-93",
    name: "Document level allowance base amount",
    kind: "BT",
    tsType: "Amount",
    required: false,
    repeats: false,
    group: "DocumentLevelAllowance",
    verified: "extraction",
    source: "text near BT-93",
  },
  {
    // T-027: not in our vendored EN16931-CII schematron at all (checked —
    // zero matches for "BT-94" in either vendored .sch file), so
    // `extraction` is genuinely impossible; this is a PEPPOL/XRechnung
    // profile-level rule, not a base EN16931 one. `well-known` here means:
    // the real CII XSD (TradeAllowanceChargeType, artifacts/cii-d16b/
    // schema/CrossIndustryInvoice_ReusableAggregateBusinessInformationEntity_100pD16B.xsd:955)
    // places `CalculationPercent` right before `BasisAmount`, and the real
    // KoSIT XRechnung validator config (not vendored — inspected inside the
    // built `einvoice-conformance-kosit:local` image, /opt/kosit/config/
    // resources/xrechnung/3.0.2/xsl/XRechnung-CII-validation.xsl, rule
    // PEPPOL-EN16931-R042: "Allowance/charge percentage MUST be provided
    // when allowance/charge base amount is provided") confirms this is
    // the percentage counterpart to BT-93 — but neither source literally
    // spells out "Document level allowance calculation percent" as an
    // English phrase to quote, so this can't be auto-checked the way
    // BT-92/93/97/98 are.
    id: "BT-94",
    name: "Document level allowance calculation percent",
    kind: "BT",
    tsType: "Amount",
    required: false,
    repeats: false,
    group: "DocumentLevelAllowance",
    verified: "well-known",
    source:
      "not independently quoted — see the comment above this term for the real (XSD + KoSIT PEPPOL-EN16931-R042) evidence that does exist",
  },
  {
    id: "BT-95",
    name: "Document level allowance VAT category code",
    kind: "BT",
    tsType: "VatCategoryCode",
    required: true,
    repeats: false,
    group: "DocumentLevelAllowance",
    verified: "extraction",
    source: "BR-IC-03",
  },
  {
    id: "BT-96",
    name: "Document level allowance VAT rate",
    kind: "BT",
    tsType: "Amount",
    required: false,
    repeats: false,
    group: "DocumentLevelAllowance",
    verified: "extraction",
    source: "BR-IC-06",
  },
  {
    id: "BT-97",
    name: "Document level allowance reason",
    kind: "BT",
    tsType: "string",
    required: false,
    repeats: false,
    group: "DocumentLevelAllowance",
    verified: "extraction",
    source: "text near BT-97",
  },
  {
    id: "BT-98",
    name: "Document level allowance reason code",
    kind: "BT",
    tsType: "string",
    required: false,
    repeats: false,
    group: "DocumentLevelAllowance",
    verified: "extraction",
    source: "text near BT-98",
  },

  // --- BG-21 Document level charge ---
  {
    id: "BG-21",
    name: "Document level charge",
    kind: "BG",
    tsType: "DocumentLevelCharge",
    required: false,
    repeats: true,
    group: "Invoice",
    verified: "extraction",
    source: "BR-IC-04",
  },
  {
    id: "BT-99",
    name: "Document level charge amount",
    kind: "BT",
    tsType: "Amount",
    required: true,
    repeats: false,
    group: "DocumentLevelCharge",
    verified: "extraction",
    source: "text near BT-99",
  },
  {
    id: "BT-100",
    name: "Document level charge base amount",
    kind: "BT",
    tsType: "Amount",
    required: false,
    repeats: false,
    group: "DocumentLevelCharge",
    verified: "extraction",
    source: "text near BT-100",
  },
  {
    // T-027: same well-known tier and same real evidence as BT-94 above —
    // BasisAmount/CalculationPercent are the same TradeAllowanceChargeType
    // regardless of allowance vs. charge, so the same XSD line and the
    // same PEPPOL-EN16931-R042 rule apply here too.
    id: "BT-101",
    name: "Document level charge calculation percent",
    kind: "BT",
    tsType: "Amount",
    required: false,
    repeats: false,
    group: "DocumentLevelCharge",
    verified: "well-known",
    source: "not independently quoted — see the comment on BT-94 for the real evidence",
  },
  {
    id: "BT-102",
    name: "Document level charge VAT category code",
    kind: "BT",
    tsType: "VatCategoryCode",
    required: true,
    repeats: false,
    group: "DocumentLevelCharge",
    verified: "extraction",
    source: "BR-IC-04",
  },
  {
    id: "BT-103",
    name: "Document level charge VAT rate",
    kind: "BT",
    tsType: "Amount",
    required: false,
    repeats: false,
    group: "DocumentLevelCharge",
    verified: "extraction",
    source: "BR-IC-07",
  },
  {
    id: "BT-104",
    name: "Document level charge reason",
    kind: "BT",
    tsType: "string",
    required: false,
    repeats: false,
    group: "DocumentLevelCharge",
    verified: "extraction",
    source: "text near BT-104",
  },
  {
    id: "BT-105",
    name: "Document level charge reason code",
    kind: "BT",
    tsType: "string",
    required: false,
    repeats: false,
    group: "DocumentLevelCharge",
    verified: "extraction",
    source: "text near BT-105",
  },

  // --- Document totals (BG-22, standard number — individual BTs all extraction-verified) ---
  {
    id: "BG-22",
    name: "Document totals",
    kind: "BG",
    tsType: "DocumentTotals",
    required: true,
    repeats: false,
    group: "Invoice",
    verified: "well-known",
    source: "standard EN 16931 group number for the totals group",
  },
  {
    id: "BT-106",
    name: "Sum of Invoice line net amount",
    kind: "BT",
    tsType: "Amount",
    required: true,
    repeats: false,
    group: "DocumentTotals",
    verified: "extraction",
    source: "text near BT-106",
  },
  {
    id: "BT-107",
    name: "Sum of allowanced on document level",
    kind: "BT",
    tsType: "Amount",
    required: false,
    repeats: false,
    group: "DocumentTotals",
    verified: "extraction",
    source: "text near BT-107",
  },
  {
    id: "BT-108",
    name: "Sum of charges on document level",
    kind: "BT",
    tsType: "Amount",
    required: false,
    repeats: false,
    group: "DocumentTotals",
    verified: "extraction",
    source: "text near BT-108",
  },
  {
    id: "BT-109",
    name: "Invoice total amount without VAT",
    kind: "BT",
    tsType: "Amount",
    required: true,
    repeats: false,
    group: "DocumentTotals",
    verified: "extraction",
    source: "BR-CO-13",
  },
  {
    id: "BT-110",
    name: "Invoice total VAT amount",
    kind: "BT",
    tsType: "Amount",
    required: false,
    repeats: false,
    group: "DocumentTotals",
    verified: "extraction",
    source: "BR-CO-14",
  },
  {
    id: "BT-111",
    name: "Invoice total VAT amount in accounting currency",
    kind: "BT",
    tsType: "Amount",
    required: false,
    repeats: false,
    group: "DocumentTotals",
    verified: "extraction",
    source: "text near BT-111",
  },
  {
    id: "BT-112",
    name: "Invoice total amount with VAT",
    kind: "BT",
    tsType: "Amount",
    required: true,
    repeats: false,
    group: "DocumentTotals",
    verified: "extraction",
    source: "BR-CO-15",
  },
  {
    id: "BT-113",
    name: "Paid amount",
    kind: "BT",
    tsType: "Amount",
    required: false,
    repeats: false,
    group: "DocumentTotals",
    verified: "extraction",
    source: "text near BT-113",
  },
  {
    id: "BT-114",
    name: "Rounding amount",
    kind: "BT",
    tsType: "Amount",
    required: false,
    repeats: false,
    group: "DocumentTotals",
    verified: "extraction",
    source: "text near BT-114",
  },
  {
    id: "BT-115",
    name: "Amount due for payment",
    kind: "BT",
    tsType: "Amount",
    required: true,
    repeats: false,
    group: "DocumentTotals",
    verified: "extraction",
    source: "BR-CO-16",
  },

  // --- BG-23 VAT breakdown ---
  {
    id: "BG-23",
    name: "VAT breakdown",
    kind: "BG",
    tsType: "VatBreakdown",
    required: true,
    repeats: true,
    group: "Invoice",
    verified: "extraction",
    source: "BR-S-08 context",
  },
  {
    id: "BT-116",
    name: "VAT category taxable amount",
    kind: "BT",
    tsType: "Amount",
    required: true,
    repeats: false,
    group: "VatBreakdown",
    verified: "extraction",
    source: "BR-S-08",
  },
  {
    id: "BT-117",
    name: "VAT category tax amount",
    kind: "BT",
    tsType: "Amount",
    required: true,
    repeats: false,
    group: "VatBreakdown",
    verified: "extraction",
    source: "BR-S-09",
  },
  {
    id: "BT-118",
    name: "VAT category code",
    kind: "BT",
    tsType: "VatCategoryCode",
    required: true,
    repeats: false,
    group: "VatBreakdown",
    verified: "extraction",
    source: "BR-CL-17/18",
  },
  {
    id: "BT-119",
    name: "VAT category rate",
    kind: "BT",
    tsType: "Amount",
    required: false,
    repeats: false,
    group: "VatBreakdown",
    verified: "extraction",
    source: "BR-CO-17",
  },
  {
    id: "BT-120",
    name: "VAT exemption reason text",
    kind: "BT",
    tsType: "string",
    required: false,
    repeats: false,
    group: "VatBreakdown",
    verified: "extraction",
    source: "BR-E-10",
  },
  {
    id: "BT-121",
    name: "VAT exemption reason code",
    kind: "BT",
    tsType: "VatexCode",
    required: false,
    repeats: false,
    group: "VatBreakdown",
    verified: "extraction",
    source: "BR-E-10",
  },

  // --- BG-24 Additional supporting document ---
  {
    id: "BG-24",
    name: "Additional supporting document",
    kind: "BG",
    tsType: "AdditionalSupportingDocument",
    required: false,
    repeats: true,
    group: "Invoice",
    verified: "extraction",
    source: "text near BG-24",
  },
  {
    id: "BT-122",
    name: "Supporting document reference",
    kind: "BT",
    tsType: "string",
    required: true,
    repeats: false,
    group: "AdditionalSupportingDocument",
    verified: "extraction",
    source: "text near BT-122",
  },

  // --- BG-25 Invoice line ---
  {
    id: "BG-25",
    name: "Invoice line",
    kind: "BG",
    tsType: "InvoiceLine",
    required: true,
    repeats: true,
    group: "Invoice",
    verified: "extraction",
    source: "BR-S-01 context",
  },
  {
    id: "BT-126",
    name: "Invoice line identifier",
    kind: "BT",
    tsType: "string",
    required: true,
    repeats: false,
    group: "InvoiceLine",
    verified: "extraction",
    source: "text near BT-126",
  },
  {
    id: "BT-129",
    name: "Invoiced quantity",
    kind: "BT",
    tsType: "Amount",
    required: true,
    repeats: false,
    group: "InvoiceLine",
    verified: "extraction",
    source: "text near BT-129",
  },
  {
    id: "BT-130",
    name: "Invoiced quantity unit of measure code",
    kind: "BT",
    tsType: "UnitCode",
    required: true,
    repeats: false,
    group: "InvoiceLine",
    verified: "extraction",
    source: "BR-CL-23",
  },
  {
    id: "BT-131",
    name: "Invoice line net amount",
    kind: "BT",
    tsType: "Amount",
    required: true,
    repeats: false,
    group: "InvoiceLine",
    verified: "extraction",
    source: "text near BT-131",
  },
  {
    id: "BT-146",
    name: "Item net price",
    kind: "BT",
    tsType: "Amount",
    required: true,
    repeats: false,
    group: "InvoiceLine",
    verified: "extraction",
    source: "text near BT-146",
  },
  {
    id: "BT-153",
    name: "Item name",
    kind: "BT",
    tsType: "string",
    required: true,
    repeats: false,
    group: "InvoiceLine",
    verified: "extraction",
    source: "text near BT-153",
  },
  // T-060 continuation (D-19/BT-158/BT-159): the customs addendum to T-060.
  // No `bg`/scheme-identifier field — this repo's v0.1 scope is HS only
  // (D-19's own wording), so the scheme identifier is a literal "HS" in
  // the CII serialization plan, not a separate model field a caller could
  // get wrong or leave unset.
  {
    id: "BT-158",
    name: "Item classification identifier",
    kind: "BT",
    tsType: "string",
    required: false,
    repeats: false,
    group: "InvoiceLine",
    verified: "extraction",
    // BR-65's own assert message quotes this name verbatim: "The Item
    // classification identifier (BT-158) shall have a Scheme identifier."
    source: "BR-65",
  },
  {
    id: "BT-159",
    name: "Item country of origin",
    kind: "BT",
    tsType: "CountryCode",
    required: false,
    repeats: false,
    group: "InvoiceLine",
    // Absent from both vendored Schematron files (confirmed: grepped
    // EN16931-CII-validation-preprocessed.sch and EN16931-CII-codes.sch
    // for "BT-159" before reaching for a different source — this BT has no
    // dedicated business rule at all, base EN 16931 CII or DE XRechnung,
    // which is *why* it's absent, not a gap in our extraction).
    verified: "e-invoice-eu-schema",
    source:
      '@e-invoice-eu/core@3.3.0 dist/e-invoice-eu.esm.js: title:"Item country of origin" on the ' +
      'cbc:IdentificationCode schema node whose description ends "Business terms: BT-159" — the same ' +
      'description text ("The code identifying the country from which the item originates.") also appears ' +
      "verbatim on docs.peppol.eu's own cac:OriginCountry/cbc:IdentificationCode page, independently.",
  },

  // --- BG-26 Invoice line period ---
  {
    id: "BG-26",
    name: "Invoice line period",
    kind: "BG",
    tsType: "InvoiceLinePeriod",
    required: false,
    repeats: false,
    group: "InvoiceLine",
    verified: "extraction",
    source: "BR-IC-11 context",
  },
  {
    id: "BT-134",
    name: "Invoice line period start date",
    kind: "BT",
    tsType: "IsoDate",
    required: false,
    repeats: false,
    group: "InvoiceLinePeriod",
    verified: "extraction",
    source: "text near BT-134",
  },
  {
    id: "BT-135",
    name: "Invoice line period end date",
    kind: "BT",
    tsType: "IsoDate",
    required: false,
    repeats: false,
    group: "InvoiceLinePeriod",
    verified: "extraction",
    source: "text near BT-135",
  },

  // --- BG-27 Invoice line allowance ---
  {
    id: "BG-27",
    name: "Invoice line allowance",
    kind: "BG",
    tsType: "InvoiceLineAllowance",
    required: false,
    repeats: true,
    group: "InvoiceLine",
    verified: "extraction",
    source: "text near BG-27",
  },
  {
    id: "BT-136",
    name: "Invoice line allowance amount",
    kind: "BT",
    tsType: "Amount",
    required: true,
    repeats: false,
    group: "InvoiceLineAllowance",
    verified: "extraction",
    source: "text near BT-136",
  },
  {
    id: "BT-137",
    name: "Invoice line allowance base amount",
    kind: "BT",
    tsType: "Amount",
    required: false,
    repeats: false,
    group: "InvoiceLineAllowance",
    verified: "extraction",
    source: "text near BT-137",
  },
  {
    // T-027: same tier/evidence as BT-94 — TradeAllowanceChargeType is
    // reused unchanged at line level (SpecifiedLineTradeSettlement/
    // SpecifiedTradeAllowanceCharge), same PEPPOL-EN16931-R042 rule.
    id: "BT-138",
    name: "Invoice line allowance calculation percent",
    kind: "BT",
    tsType: "Amount",
    required: false,
    repeats: false,
    group: "InvoiceLineAllowance",
    verified: "well-known",
    source: "not independently quoted — see the comment on BT-94 for the real evidence",
  },
  {
    id: "BT-139",
    name: "Invoice line allowance reason",
    kind: "BT",
    tsType: "string",
    required: false,
    repeats: false,
    group: "InvoiceLineAllowance",
    verified: "extraction",
    source: "text near BT-139",
  },
  {
    id: "BT-140",
    name: "Invoice line allowance reason code",
    kind: "BT",
    tsType: "string",
    required: false,
    repeats: false,
    group: "InvoiceLineAllowance",
    verified: "extraction",
    source: "text near BT-140",
  },

  // --- BG-28 Invoice line charge ---
  {
    id: "BG-28",
    name: "Invoice line charge",
    kind: "BG",
    tsType: "InvoiceLineCharge",
    required: false,
    repeats: true,
    group: "InvoiceLine",
    verified: "extraction",
    source: "text near BG-28",
  },
  {
    id: "BT-141",
    name: "Invoice line charge amount",
    kind: "BT",
    tsType: "Amount",
    required: true,
    repeats: false,
    group: "InvoiceLineCharge",
    verified: "extraction",
    source: "text near BT-141",
  },
  {
    id: "BT-142",
    name: "Invoice line charge base amount",
    kind: "BT",
    tsType: "Amount",
    required: false,
    repeats: false,
    group: "InvoiceLineCharge",
    verified: "extraction",
    source: "text near BT-142",
  },
  {
    // T-027: same tier/evidence as BT-94.
    id: "BT-143",
    name: "Invoice line charge calculation percent",
    kind: "BT",
    tsType: "Amount",
    required: false,
    repeats: false,
    group: "InvoiceLineCharge",
    verified: "well-known",
    source: "not independently quoted — see the comment on BT-94 for the real evidence",
  },
  {
    id: "BT-144",
    name: "Invoice line charge reason",
    kind: "BT",
    tsType: "string",
    required: false,
    repeats: false,
    group: "InvoiceLineCharge",
    verified: "extraction",
    source: "text near BT-144",
  },
  {
    id: "BT-145",
    name: "Invoice line charge reason code",
    kind: "BT",
    tsType: "string",
    required: false,
    repeats: false,
    group: "InvoiceLineCharge",
    verified: "extraction",
    source: "text near BT-145",
  },

  // --- BG-30 Line VAT information (standard number; both BTs extraction-verified) ---
  {
    id: "BG-30",
    name: "Line VAT information",
    kind: "BG",
    tsType: "LineVat",
    required: true,
    repeats: false,
    group: "InvoiceLine",
    verified: "well-known",
    source: "standard EN 16931 group number for line-level VAT",
  },
  {
    id: "BT-151",
    name: "Invoiced item VAT category code",
    kind: "BT",
    tsType: "VatCategoryCode",
    required: true,
    repeats: false,
    group: "LineVat",
    verified: "extraction",
    source: "BR-CL-17/18 context",
  },
  {
    id: "BT-152",
    name: "Invoiced item VAT rate",
    kind: "BT",
    tsType: "Amount",
    required: false,
    repeats: false,
    group: "LineVat",
    verified: "extraction",
    source: "BR-IC-05",
  },

  // --- BG-32 Item attribute ---
  {
    id: "BG-32",
    name: "Item attribute",
    kind: "BG",
    tsType: "ItemAttribute",
    required: false,
    repeats: true,
    group: "InvoiceLine",
    verified: "extraction",
    source: "text near BG-32",
  },
  {
    id: "BT-160",
    name: "Item attribute name",
    kind: "BT",
    tsType: "string",
    required: true,
    repeats: false,
    group: "ItemAttribute",
    verified: "extraction",
    source: "text near BT-160",
  },
  {
    id: "BT-161",
    name: "Item attribute value",
    kind: "BT",
    tsType: "string",
    required: true,
    repeats: false,
    group: "ItemAttribute",
    verified: "extraction",
    source: "text near BT-161",
  },

  // --- XRechnung-profile-required fields (T-021), found by running our
  // serializer output through the real KoSIT validator. Each `source`
  // quotes the exact validator message or the exact XPath asserted in
  // XRechnung-CII-validation.xsl (KoSIT, Apache-2.0). ---
  {
    id: "BT-23",
    name: "Business process type",
    kind: "BT",
    tsType: "string",
    required: false,
    repeats: false,
    group: "Invoice",
    verified: "kosit-xrechnung",
    source:
      "PEPPOL-EN16931-R001: 'Business process MUST be provided.' — test=\"not(ram:BusinessProcessSpecifiedDocumentContextParameter/ram:ID)\", context rsm:ExchangedDocumentContext",
  },
  {
    id: "BT-34",
    name: "Seller electronic address",
    kind: "BT",
    tsType: "string",
    required: false,
    repeats: false,
    group: "SellerParty",
    verified: "kosit-xrechnung",
    source:
      "PEPPOL-EN16931-R020: 'Seller electronic address MUST be provided' — test=\"not(ram:URIUniversalCommunication/ram:URIID)\", context ram:SellerTradeParty",
  },
  {
    id: "BT-34-1",
    name: "Seller electronic address scheme identifier",
    kind: "BT",
    tsType: "EasCode",
    required: false,
    repeats: false,
    group: "SellerParty",
    verified: "kosit-xrechnung",
    source:
      "BR-CL-25 (ConnectingEurope EUPL-1.2 codes.sch): 'Endpoint identifier scheme identifier MUST belong to the CEF EAS code list' — this is BT-34's @schemeID attribute, not a separately numbered BT; the '-1' suffix is our own convention for a scheme qualifier, not an official EN 16931 id",
  },
  {
    id: "BT-49",
    name: "Buyer electronic address",
    kind: "BT",
    tsType: "string",
    required: false,
    repeats: false,
    group: "BuyerParty",
    verified: "kosit-xrechnung",
    source:
      "PEPPOL-EN16931-R010: 'Buyer electronic address MUST be provided' — test=\"not(ram:URIUniversalCommunication/ram:URIID)\", context ram:BuyerTradeParty",
  },
  {
    id: "BT-49-1",
    name: "Buyer electronic address scheme identifier",
    kind: "BT",
    tsType: "EasCode",
    required: false,
    repeats: false,
    group: "BuyerParty",
    verified: "kosit-xrechnung",
    source: "Same BR-CL-25 basis as BT-34-1, applied to the buyer's endpoint identifier",
  },
  {
    id: "BG-6",
    name: "Seller contact",
    kind: "BG",
    tsType: "SellerContact",
    required: false,
    repeats: false,
    group: "SellerParty",
    verified: "kosit-xrechnung",
    source: "BR-DE-2: 'Die Gruppe \"SELLER CONTACT\" (BG-6) muss übermittelt werden.'",
  },
  {
    id: "BT-41",
    name: "Seller contact point",
    kind: "BT",
    tsType: "string",
    required: true,
    repeats: false,
    group: "SellerContact",
    verified: "kosit-xrechnung",
    source:
      "CII-SR-465 mentions 'BT-41 element' for SellerTradeParty/DefinedTradeContact/PersonName|DepartmentName; BR-DE-2 requires the DefinedTradeContact group to exist",
  },
  {
    id: "BT-35",
    name: "Seller address line 1",
    kind: "BT",
    tsType: "string",
    required: false,
    repeats: false,
    group: "SellerParty",
    verified: "e-invoice-eu-schema",
    source:
      '@e-invoice-eu/core@3.3.0 dist/e-invoice-eu.esm.js: title:"Seller address line 1" on the cbc:StreetName schema node ' +
      'whose description ends "Business terms: BT-35" — the same description text ("The main address line in an address.") ' +
      "also appears verbatim on docs.peppol.eu's own cac:AccountingSupplierParty/cac:Party/cac:PostalAddress/cbc:StreetName page (Peppol BIS Billing 3.0 UBL " +
      "syntax, which names BT-35 there too), independently. No rule in the vendored Schematron names it.",
  },
  {
    id: "BT-36",
    name: "Seller address line 2",
    kind: "BT",
    tsType: "string",
    required: false,
    repeats: false,
    group: "SellerParty",
    verified: "e-invoice-eu-schema",
    source:
      '@e-invoice-eu/core@3.3.0 dist/e-invoice-eu.esm.js: title:"Seller address line 2" on the cbc:AdditionalStreetName schema node ' +
      'whose description ends "Business terms: BT-36" — the same description text ("An additional address line in an address that can be used…") ' +
      "also appears verbatim on docs.peppol.eu's own cac:AccountingSupplierParty/cac:Party/cac:PostalAddress/cbc:AdditionalStreetName page (Peppol BIS Billing 3.0 UBL " +
      "syntax, which names BT-36 there too), independently. No rule in the vendored Schematron names it.",
  },
  {
    id: "BT-37",
    name: "Seller city",
    kind: "BT",
    tsType: "string",
    required: true,
    repeats: false,
    group: "SellerParty",
    verified: "kosit-xrechnung",
    source: "BR-DE-3: 'Das Element \"Seller city\" (BT-37) muss übermittelt werden.'",
  },
  {
    id: "BT-38",
    name: "Seller post code",
    kind: "BT",
    tsType: "string",
    required: true,
    repeats: false,
    group: "SellerParty",
    verified: "kosit-xrechnung",
    source: "BR-DE-4: 'Das Element \"Seller post code\" (BT-38) muss übermittelt werden.'",
  },
  {
    id: "BT-50",
    name: "Buyer address line 1",
    kind: "BT",
    tsType: "string",
    required: false,
    repeats: false,
    group: "BuyerParty",
    verified: "e-invoice-eu-schema",
    source:
      '@e-invoice-eu/core@3.3.0 dist/e-invoice-eu.esm.js: title:"Buyer address line 1" on the cbc:StreetName schema node ' +
      'whose description ends "Business terms: BT-50" — the same description text ("The main address line in an address.") ' +
      "also appears verbatim on docs.peppol.eu's own cac:AccountingCustomerParty/cac:Party/cac:PostalAddress/cbc:StreetName page (Peppol BIS Billing 3.0 UBL " +
      "syntax, which names BT-50 there too), independently. No rule in the vendored Schematron names it.",
  },
  {
    id: "BT-51",
    name: "Buyer address line 2",
    kind: "BT",
    tsType: "string",
    required: false,
    repeats: false,
    group: "BuyerParty",
    verified: "e-invoice-eu-schema",
    source:
      '@e-invoice-eu/core@3.3.0 dist/e-invoice-eu.esm.js: title:"Buyer address line 2" on the cbc:AdditionalStreetName schema node ' +
      'whose description ends "Business terms: BT-51" — the same description text ("An additional address line in an address that can be used…") ' +
      "also appears verbatim on docs.peppol.eu's own cac:AccountingCustomerParty/cac:Party/cac:PostalAddress/cbc:AdditionalStreetName page (Peppol BIS Billing 3.0 UBL " +
      "syntax, which names BT-51 there too), independently. No rule in the vendored Schematron names it.",
  },
  {
    id: "BT-52",
    name: "Buyer city",
    kind: "BT",
    tsType: "string",
    required: true,
    repeats: false,
    group: "BuyerParty",
    verified: "kosit-xrechnung",
    source: "BR-DE-8: 'Das Element \"Buyer city\" (BT-52) muss übermittelt werden.'",
  },
  {
    id: "BT-53",
    name: "Buyer post code",
    kind: "BT",
    tsType: "string",
    required: true,
    repeats: false,
    group: "BuyerParty",
    verified: "kosit-xrechnung",
    source: "BR-DE-9: 'Das Element \"Buyer post code\" (BT-53) muss übermittelt werden.'",
  },
  {
    id: "BT-42",
    name: "Seller contact telephone number",
    kind: "BT",
    tsType: "string",
    required: true,
    repeats: false,
    group: "SellerContact",
    verified: "kosit-xrechnung",
    source:
      "BR-DE-6: 'Das Element \"Seller contact telephone number\" (BT-42) muss übermittelt werden.'",
  },
  {
    id: "BT-43",
    name: "Seller contact email address",
    kind: "BT",
    tsType: "string",
    required: true,
    repeats: false,
    group: "SellerContact",
    verified: "kosit-xrechnung",
    source:
      "BR-DE-7: 'Das Element \"Seller contact email address\" (BT-43) muss übermittelt werden.'",
  },
  {
    id: "BT-75",
    name: "Deliver to address line 1",
    kind: "BT",
    tsType: "string",
    required: false,
    repeats: false,
    group: "Delivery",
    verified: "e-invoice-eu-schema",
    source:
      '@e-invoice-eu/core@3.3.0 dist/e-invoice-eu.esm.js: title:"Deliver to address line 1" on the cbc:StreetName schema node ' +
      'whose description ends "Business terms: BT-75" — the same description text ("The main address line in an address.") ' +
      "also appears verbatim on docs.peppol.eu's own cac:Delivery/cac:DeliveryLocation/cac:Address/cbc:StreetName page (Peppol BIS Billing 3.0 UBL " +
      "syntax, which names BT-75 there too), independently. No rule in the vendored Schematron names it.",
  },
  {
    id: "BT-76",
    name: "Deliver to address line 2",
    kind: "BT",
    tsType: "string",
    required: false,
    repeats: false,
    group: "Delivery",
    verified: "e-invoice-eu-schema",
    source:
      '@e-invoice-eu/core@3.3.0 dist/e-invoice-eu.esm.js: title:"Deliver to address line 2" on the cbc:AdditionalStreetName schema node ' +
      'whose description ends "Business terms: BT-76" — the same description text ("An additional address line in an address that can be used…") ' +
      "also appears verbatim on docs.peppol.eu's own cac:Delivery/cac:DeliveryLocation/cac:Address/cbc:AdditionalStreetName page (Peppol BIS Billing 3.0 UBL " +
      "syntax, which names BT-76 there too), independently. No rule in the vendored Schematron names it.",
  },
  {
    id: "BT-77",
    name: "Deliver to city",
    kind: "BT",
    tsType: "string",
    required: false,
    repeats: false,
    group: "Delivery",
    verified: "kosit-xrechnung",
    source:
      'BR-DE-10: \'Das Element "Deliver to city" (BT-77) muss übermittelt werden, wenn die Gruppe "DELIVER TO ADDRESS" (BG-15) übermittelt wird.\'',
  },
  {
    id: "BT-78",
    name: "Deliver to post code",
    kind: "BT",
    tsType: "string",
    required: false,
    repeats: false,
    group: "Delivery",
    verified: "kosit-xrechnung",
    source:
      'BR-DE-11: \'Das Element "Deliver to post code" (BT-78) muss übermittelt werden, wenn die Gruppe "DELIVER TO ADDRESS" (BG-15) übermittelt wird.\'',
  },
];
