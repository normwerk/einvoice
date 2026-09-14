/**
 * T-060/W9: `CommerceInvoiceInput` — the platform-agnostic contract every
 * adapter (`einvoice-medusa` today, a Vendure one later, or a hand-built
 * integration from outside this repo) maps its own order/refund shape
 * into. No Medusa or Vendure type may appear here, ever (`AGENTS.md` §6).
 *
 * Shape fixed by ADR-003 (`docs/adr/003-commerce-invoice-input.md`), which
 * this file implements. `CommerceParty`/`CommerceLine`/`CommerceCharge`/
 * `TaxContext` were left as a draft there ("as drafted in plan-v0.1 §4.4 —
 * reproduced in the package's own types when T-060 implements this, not
 * duplicated") — the exact fields below are this implementation's
 * completion of that draft, not a re-derivation of anything already fixed.
 */
import type {
  Amount,
  CountryCode,
  CurrencyCode,
  EasCode,
  IsoDate,
  PaymentMeansCode,
  VatCategoryCode,
  VatexCode,
} from "@normwerk/einvoice-model";

/** ADR-003: bump only for a breaking change to this shape (AGENTS.md-style semver discipline for a wire contract, not a package). */
export type CommerceInvoiceInputSchemaVersion = 1;

export interface CommerceInvoiceInput {
  readonly schemaVersion: CommerceInvoiceInputSchemaVersion;
  readonly document: {
    readonly kind: "invoice" | "credit-note";
    /** Omit if numbering is delegated to `InvoiceNumberer` (T-063) or an external plugin. */
    readonly number?: string;
    readonly issueDate: IsoDate;
    readonly currency: CurrencyCode;
    /** BT-25/26. Required by `buildInvoice` when `kind === 'credit-note'` (T-064) — the base EN 16931
     * Schematron does not force this (BR-55 only fires if a preceding-invoice-reference group is present
     * at all, docs/tax-semantics.md row 10), so this package enforces it itself rather than relying on the
     * validator to catch a credit note that forgot what it corrects. */
    readonly correctedInvoice?: { readonly number: string; readonly issueDate: IsoDate };
  };
  readonly seller: CommerceParty;
  readonly buyer: CommerceParty;
  readonly lines: readonly CommerceLine[];
  readonly shipping?: CommerceCharge;
  readonly discounts?: readonly CommerceCharge[];
  readonly payment?: {
    readonly means?: PaymentMeansCode;
    readonly terms?: string;
    readonly iban?: string;
  };
  readonly references?: {
    /** BT-10. Also carries a Leitweg-ID for a German public-sector buyer (B2G) — T-062. */
    readonly buyerReference?: string;
    readonly orderReference?: string; // BT-13
    readonly contractReference?: string; // BT-12
  };
  /**
   * BG-13. Optional in general, but `buildInvoice` requires `actualDeliveryDate` and
   * `deliverToCountryCode` when the resolved VAT category is K (intra-EU supply) — found by actually
   * running a KoSIT-rejected commerce fixture, not anticipated when ADR-003 first fixed this contract's
   * shape: `BR-IC-11`/`BR-IC-12` require exactly these two facts for that category specifically (no other
   * category in `docs/tax-semantics.md`'s table has an equivalent delivery-info rule — verified against
   * the vendored Schematron, not assumed from the K case alone).
   */
  readonly delivery?: {
    readonly actualDeliveryDate?: IsoDate;
    readonly deliverToCountryCode?: CountryCode;
    readonly deliverToCity?: string;
    readonly deliverToPostCode?: string;
  };
  readonly taxContext: TaxContext;
  /** D-19: optional customs block — coincidental byproduct of Probe 1, predicate for Probe 2. Not yet
   * mapped to BT-158/159 by `buildInvoice` (the model doesn't carry those fields yet — a separate,
   * dedicated model-codegen task, not this one); carried on the input type now so adapters can start
   * populating it without a breaking schemaVersion bump later. */
  readonly customs?: {
    readonly incoterm?: string;
    readonly sellerEori?: string;
    readonly buyerEori?: string;
    readonly iossNumber?: string;
  };
}

export interface CommerceParty {
  readonly name: string;
  readonly countryCode: CountryCode;
  /** Required — every DE fixture in this repo carries it, and `SellerParty`/`BuyerParty`
   * (`@normwerk/einvoice-model`) require it structurally; there is no v0.1 scenario without it. */
  readonly city: string;
  readonly postCode: string;
  readonly vatIdentifier?: string;
  readonly legalRegistrationIdentifier?: string;
  readonly electronicAddress?: string;
  readonly electronicAddressScheme?: EasCode;
  /** BG-6. `buildInvoice` requires this on the seller when the resolved e-invoice profile is XRECHNUNG
   * (BR-DE-2 — Germany's own CIUS makes seller contact mandatory; the base EN 16931 Schematron does not). */
  readonly contact?: {
    readonly name: string;
    readonly telephone: string;
    readonly email: string;
  };
}

export interface CommerceLine {
  /** Omit to default to a 1-based position (`String(index + 1)`). */
  readonly identifier?: string;
  readonly quantity: Amount;
  readonly unitCode: string;
  readonly netPrice: Amount;
  readonly itemName: string;
  /**
   * Which of the seller's own product tax classifications this line falls under. Only consulted when the
   * document-level regime resolves to a rate that varies per product (`decideVatCategory`'s domestic/OSS
   * regimes, category S) — ignored for K/G/AE/E/Z, which are uniform for the whole commercial transaction
   * in this v0.1 rule table (`docs/tax-semantics.md`). Required whenever it's consulted; `buildInvoice`
   * throws rather than guessing a rate for a line that needs one and doesn't have it.
   */
  readonly taxRateKind?: "standard" | "reduced";
  /** D-19/BT-158. Not yet mapped — see `CommerceInvoiceInput.customs`. */
  readonly hsCode?: string;
  /** D-19/BT-159. Not yet mapped — see `CommerceInvoiceInput.customs`. */
  readonly originCountry?: CountryCode;
}

/** Document-level shipping cost or discount (BG-20/BG-21) — no line-level allowance/charge in this input
 * type (plan-v0.1 §4.4 draft only has document-level `shipping`/`discounts`; a line-level one would need
 * its own BT-138/143 calculation-percent handling, T-027 — deferred, not needed by any W9 scenario). */
export interface CommerceCharge {
  readonly amount: Amount;
  readonly reason?: string;
}

export interface TaxContext {
  readonly sellerCountry: CountryCode;
  readonly sellerVatId: string;
  readonly buyerCountry: CountryCode;
  readonly buyerVatId?: string;
  readonly buyerIsBusiness: boolean;
  readonly ossRegistered: boolean;
  readonly supplyType: "goods" | "services" | "mixed";
  /**
   * Only the OSS regime (`docs/tax-semantics.md` row 7) reaches here — this package does not maintain a
   * table of every EU member state's VAT rates (a real, non-trivial, frequently-changing dataset this repo
   * has no vendored/verified source for), and the row itself is flagged "⚠️ outside the DE B2B/B2G mandate
   * this project targets ... not fully resolved here". The caller (who already had to look up the buyer
   * country's rate to charge the customer correctly at checkout) supplies it; `decideVatCategory` refuses
   * to select the OSS regime without it rather than silently using Germany's rate.
   */
  readonly ossRateOverride?: Amount;
  /**
   * Explicit signal for the three regimes `TaxContext`'s other fields cannot derive on their own —
   * `docs/tax-semantics.md` rows 5, 6, 8. Each is a legal/factual judgment about the *nature* of the
   * supply (a specific reverse-charge-eligible service, a specific UStG §4 exemption, a rare zero-rate
   * case) that no combination of country codes and VAT-ID presence can infer; `decideVatCategory` refuses
   * to select AE/E/Z without one (matches plan-v0.1's D-19 "не выбираются без ... явного override").
   */
  readonly regimeOverride?: RegimeOverride;
}

export type RegimeOverride =
  | {
      readonly kind: "reverse-charge";
      /** Defaults to the bilingual text this repo's own `de-b2b-reverse-charge` fixture uses. */
      readonly reasonText?: string;
    }
  | {
      readonly kind: "exempt";
      /** Mandatory (BR-E-10) — `docs/tax-semantics.md` row 6: no single universal VATEX code covers every
       * UStG §4 exemption, so unlike reverse-charge/intra-EU/export this has no fallback text. */
      readonly reasonText: string;
      readonly reasonCode?: VatexCode;
    }
  | {
      /** No reason text/code field — BR-Z-10 forbids a BT-120/121 exemption text on a Z line at all
       * (`docs/tax-semantics.md` row 8); enforced here at the type level, not by a runtime check
       * `decideVatCategory` could forget. */
      readonly kind: "zero-rated";
    }
  | {
      /** VIES was unavailable or the number predates VIES coverage, but the merchant manually confirmed
       * the buyer's intra-EU VAT-ID some other way and is recording that as the evidence for category K
       * (D-19's "явный override"). `evidenceNote` is carried into `TaxDecision.reasoning` for audit. */
      readonly kind: "intra-eu-confirmed";
      readonly evidenceNote: string;
    };

/** D-19: the sole source of a buyer VAT-ID's status. A real VIES-backed implementation is deferred to v0.2
 * (plan-v0.1 §9 W9's own pre-approved contingency: "при нехватке времени — интерфейс + mock в v0.1,
 * референсная реализация VIES в v0.2") — only the interface and a test-oriented mock exist here. */
export interface VatIdVerifier {
  verify(vatId: string, now: Date): Promise<VatIdEvidence>;
}

export interface VatIdEvidence {
  readonly vatId: string;
  readonly status: "valid" | "invalid" | "unavailable";
  readonly checkedAt: IsoDate;
  /** VIES's own proof-of-check reference, when the check succeeded (valid or invalid, not unavailable). */
  readonly consultationNumber?: string;
}

export interface TaxDecision {
  /** Stable id matching a `docs/tax-semantics.md` row, e.g. `"tax-semantics#3"` — the audit trail this
   * whole mechanism exists for (plan-v0.1 §4.4: "decisions — не украшение"). */
  readonly ruleId: string;
  readonly categoryCode: VatCategoryCode;
  readonly exemptionReasonCode?: VatexCode;
  readonly exemptionReasonText?: string;
  readonly reasoning: string;
}

export interface BuildWarning {
  readonly code: string;
  readonly message: string;
}

export interface BuildResult {
  readonly invoice: import("@normwerk/einvoice-model").Invoice;
  readonly decisions: readonly TaxDecision[];
  readonly warnings: readonly BuildWarning[];
  readonly vatIdEvidence?: VatIdEvidence;
}
