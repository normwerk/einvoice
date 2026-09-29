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
    readonly number?: string | undefined;
    readonly issueDate: IsoDate;
    readonly currency: CurrencyCode;
    /** BT-25/26. Required by `buildInvoice` when `kind === 'credit-note'` (T-064) — the base EN 16931
     * Schematron does not force this (BR-55 only fires if a preceding-invoice-reference group is present
     * at all, docs/tax-semantics.md row 10), so this package enforces it itself rather than relying on the
     * validator to catch a credit note that forgot what it corrects. */
    readonly correctedInvoice?:
      { readonly number: string; readonly issueDate: IsoDate } | undefined;
  };
  readonly seller: CommerceParty;
  readonly buyer: CommerceParty;
  readonly lines: readonly CommerceLine[];
  readonly shipping?: CommerceShipping | undefined;
  readonly discounts?: readonly CommerceCharge[] | undefined;
  /**
   * P-67: when the document invoices part of a supply — one shipment of an order — and carries charges that
   * belong to all of it (the order's shipping), the lines of the whole supply. In a basket with more than one
   * VAT rate, `shipping` and `discounts` are split across the rates in proportion to these lines' net
   * amounts instead of the document's own: a first shipment of only the 7 % goods still carries the shipping
   * share of the 19 % goods to come. Only their amounts and rates are read. Omitted, the document's own lines
   * are the weights.
   */
  readonly chargeSplitLines?: readonly CommerceLine[] | undefined;
  /**
   * P-67: BT-113, what the buyer already paid of this document's total — the whole total for an order paid
   * in full before it shipped. The amount due (BT-115) is what is left. At most the total.
   */
  readonly paidAmount?: Amount | undefined;
  readonly payment?:
    | {
        /** BT-81 — mandatory whenever `payment` is given: BR-49 requires it in every payment instruction. */
        readonly means: PaymentMeansCode;
        readonly terms?: string | undefined;
        readonly iban?: string | undefined;
      }
    | undefined;
  readonly references?:
    | {
        /** BT-10: the buyer's own reference for this invoice, free text. Never read as a Leitweg-ID. */
        readonly buyerReference?: string | undefined;
        /**
         * P-54: the Leitweg-ID of a German public-sector buyer (B2G) — a declared fact, never inferred from
         * the shape of `buyerReference` (an ordinary reference such as "2024-01" has that shape too).
         * `buildInvoice` validates it, check digits included, and writes it to BT-10, so give it instead of
         * `buyerReference`, not with it. `selectProfile` takes it as the signal for XRechnung.
         */
        readonly leitwegId?: string | undefined;
        readonly orderReference?: string | undefined; // BT-13
        readonly contractReference?: string | undefined; // BT-12
      }
    | undefined;
  /**
   * BG-13. Optional in general, but `buildInvoice` requires `actualDeliveryDate` and
   * `deliverToCountryCode` when the resolved VAT category is K (intra-EU supply) — found by actually
   * running a KoSIT-rejected commerce fixture, not anticipated when ADR-003 first fixed this contract's
   * shape: `BR-IC-11`/`BR-IC-12` require exactly these two facts for that category specifically (no other
   * category in `docs/tax-semantics.md`'s table has an equivalent delivery-info rule — verified against
   * the vendored Schematron, not assumed from the K case alone).
   */
  readonly delivery?:
    | {
        readonly actualDeliveryDate?: IsoDate | undefined;
        readonly deliverToCountryCode?: CountryCode | undefined;
        readonly deliverToCity?: string | undefined;
        readonly deliverToPostCode?: string | undefined;
        readonly deliverToAddressLine1?: string | undefined; // BT-75
        readonly deliverToAddressLine2?: string | undefined; // BT-76
      }
    | undefined;
  readonly taxContext: TaxContext;
  /** D-19: optional customs block — coincidental byproduct of Probe 1, predicate for Probe 2. Not yet
   * mapped to BT-158/159 by `buildInvoice` (the model doesn't carry those fields yet — a separate,
   * dedicated model-codegen task, not this one); carried on the input type now so adapters can start
   * populating it without a breaking schemaVersion bump later. */
  readonly customs?:
    | {
        readonly incoterm?: string | undefined;
        readonly sellerEori?: string | undefined;
        readonly buyerEori?: string | undefined;
        readonly iossNumber?: string | undefined;
      }
    | undefined;
}

export interface CommerceParty {
  readonly name: string;
  readonly countryCode: CountryCode;
  /** Required — every DE fixture in this repo carries it, and `SellerParty`/`BuyerParty`
   * (`@normwerk/einvoice-model`) require it structurally; there is no v0.1 scenario without it. */
  readonly city: string;
  readonly postCode: string;
  /** BT-35 (seller) / BT-50 (buyer): the street and house number, or a PO box. `buildInvoice` requires it
   * on the seller — §14 Abs. 4 Satz 1 Nr. 1 UStG needs the seller's full address on every invoice, a
   * small-amount one (§33 UStDV) included — and warns when the buyer's is missing above EUR 250. */
  readonly addressLine1?: string | undefined;
  /** BT-36 (seller) / BT-51 (buyer): a second address line. */
  readonly addressLine2?: string | undefined;
  readonly vatIdentifier?: string | undefined;
  readonly legalRegistrationIdentifier?: string | undefined;
  readonly electronicAddress?: string | undefined;
  readonly electronicAddressScheme?: EasCode | undefined;
  /** BG-6. `buildInvoice` requires this on the seller for every document: each one declares the XRechnung
   * 3.0 CIUS, whose BR-DE-2 makes seller contact mandatory (the base EN 16931 Schematron does not). */
  readonly contact?:
    | {
        readonly name: string;
        readonly telephone: string;
        readonly email: string;
      }
    | undefined;
}

export interface CommerceLine {
  /** Omit to default to a 1-based position (`String(index + 1)`). */
  readonly identifier?: string | undefined;
  readonly quantity: Amount;
  readonly unitCode: string;
  /** The unit price before VAT. Give exactly one of `netPrice` and `priceInclVat`. */
  readonly netPrice?: Amount | undefined;
  /**
   * P-61: the unit price including VAT, for a shop whose prices include it. `buildInvoice` then keeps the
   * gross amounts the buyer was charged: each VAT rate group's VAT is taken out of the group's gross total
   * (`vatContainedIn`), and the group's net is spread over its lines and charges to the cent. The line's
   * `allowances` are VAT-inclusive too.
   */
  readonly priceInclVat?: Amount | undefined;
  readonly itemName: string;
  /**
   * Which of the seller's own product tax classifications this line falls under. Only consulted when the
   * document-level regime resolves to a rate that varies per product (`decideVatCategory`'s domestic/OSS
   * regimes, category S) — ignored for K/G/AE/E/Z, which are uniform for the whole commercial transaction
   * in this v0.1 rule table (`docs/tax-semantics.md`). When it's consulted, `buildInvoice` needs this or
   * `chargedVatRate`, and throws rather than guessing a rate for a line that has neither.
   */
  readonly taxRateKind?: "standard" | "reduced" | undefined;
  /**
   * The VAT rate the shop charged on this line at checkout, as a percentage ("19", "5.5"), when the platform
   * records one. Consulted where `taxRateKind` is: a line is never invoiced at a rate it was not charged at.
   * Domestically it must be 19 or 7, and gives the rate kind when `taxRateKind` is omitted; in an OSS sale it
   * must equal `TaxContext.ossRateOverride`. Anything else is refused.
   */
  readonly chargedVatRate?: Amount | undefined;
  /**
   * T-199 (P-73): on a credit note, the VAT rate (BT-152) the corrected invoice stated for what this line
   * credits. The line is credited at exactly that rate — §17 UStG corrects the supply as it was invoiced — not
   * at one resolved from `taxRateKind`, `chargedVatRate` or the rate table: a rate change since, or a table
   * wrong about a past period, cannot change it. Read for category S; refused on an invoice.
   */
  readonly invoicedVatRate?: Amount | undefined;
  /**
   * T-069/D-50 point 6: forward-compatible groundwork, not yet consumed. `decideVatCategory` still reads
   * only the single whole-order `TaxContext.supplyType` aggregate an adapter derives from all of a
   * document's lines — true per-line category resolution (docs/tax-semantics.md's "variant в") is
   * deliberately deferred until M-006's C-1 resolves, not scoped to this field's introduction. Present now
   * so that a future change doesn't need a breaking `schemaVersion` bump to add it.
   */
  readonly supplyType?: "goods" | "services" | undefined;
  /**
   * Discounts that belong to this line (BG-27, e.g. a platform promotion applied to one item) — net
   * amounts, deducted from this line's own net amount, so each one reduces the VAT base of exactly the
   * rate this line carries. Expressing them per line, rather than as one document-level discount, is what
   * keeps a mixed-rate basket from needing an apportioning rule at all.
   */
  readonly allowances?: readonly CommerceLineAllowance[] | undefined;
  /** D-19/BT-158. Not yet mapped — see `CommerceInvoiceInput.customs`. */
  readonly hsCode?: string | undefined;
  /** D-19/BT-159. Not yet mapped — see `CommerceInvoiceInput.customs`. */
  readonly originCountry?: CountryCode | undefined;
}

/** BG-27 Invoice line allowance — net, or VAT-inclusive on a line priced with `priceInclVat`. BR-42 requires
 * a reason (or reason code) on every one, so the reason is mandatory here rather than defaulted by this
 * package. */
export interface CommerceLineAllowance {
  readonly amount: Amount;
  readonly reason: string;
}

/** Document-level shipping cost or discount (BG-20/BG-21). Line-level discounts are
 * `CommerceLine.allowances`; line-level charges (BG-28) and calculation percents (BT-138/143) are not part
 * of this input type. */
export interface CommerceCharge {
  /** The amount before VAT. Give exactly one of `amount` and `amountInclVat`. */
  readonly amount?: Amount | undefined;
  /** P-61: the amount including VAT — see `CommerceLine.priceInclVat`. */
  readonly amountInclVat?: Amount | undefined;
  readonly reason?: string | undefined;
}

/** The shipping charge, with the rate the shop charged on it. */
export interface CommerceShipping extends CommerceCharge {
  /**
   * T-203: the VAT rate the shop charged on shipping, as a percentage, when the platform records one — the
   * highest, over several shipping methods. Read only to tell an order on which the shop charged no VAT at
   * all (`NO_VAT_CHARGED`) from one whose settings miss a rate: the invoice's shipping takes the rate of the
   * supply it belongs to, never this one.
   */
  readonly chargedVatRate?: Amount | undefined;
}

export interface TaxContext {
  readonly sellerCountry: CountryCode;
  readonly sellerVatId: string;
  readonly buyerCountry: CountryCode;
  readonly buyerVatId?: string | undefined;
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
  readonly ossRateOverride?: Amount | undefined;
  /**
   * Explicit signal for the three regimes `TaxContext`'s other fields cannot derive on their own —
   * `docs/tax-semantics.md` rows 5, 6, 8. Each is a legal/factual judgment about the *nature* of the
   * supply (a specific reverse-charge-eligible service, a specific UStG §4 exemption, a rare zero-rate
   * case) that no combination of country codes and VAT-ID presence can infer; `decideVatCategory` refuses
   * to select AE/E/Z without one (matches plan-v0.1's D-19 "не выбираются без ... явного override").
   */
  readonly regimeOverride?: RegimeOverride | undefined;
}

export type RegimeOverride =
  | {
      readonly kind: "reverse-charge";
      /** Defaults to the bilingual text this repo's own `de-b2b-reverse-charge` fixture uses. */
      readonly reasonText?: string | undefined;
    }
  | {
      readonly kind: "exempt";
      /** Mandatory (BR-E-10) — `docs/tax-semantics.md` row 6: no single universal VATEX code covers every
       * UStG §4 exemption, so unlike reverse-charge/intra-EU/export this has no fallback text. */
      readonly reasonText: string;
      readonly reasonCode?: VatexCode | undefined;
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
    }
  | {
      /** T-135/P-34: `docs/tax-semantics.md` row 12 (DE→EU B2B service) has a settled category — AE, §3a
       * Abs. 2 UStG / Art. 44+196 VAT Directive — but no official artifact confirms a real validator
       * accepts it, so `decideVatCategory` refuses by default pending M-006. This lets a merchant declare
       * the fact anyway, the same "accept a declared fact, never infer it" shape row 3's
       * `intra-eu-confirmed` already uses for K. A distinct kind from row 5's `reverse-charge`, not a
       * relaxed guard on it — §13b UStG (domestic) and §3a Abs. 2 UStG/Art. 44+196 (cross-border) are
       * different legal bases, and merging them would lose the `ruleId`/exemption-text trail M-006's
       * reviewer needs to tell them apart. */
      readonly kind: "reverse-charge-cross-border";
      readonly reasonText?: string | undefined;
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
  readonly consultationNumber?: string | undefined;
}

export interface TaxDecision {
  /** Stable id matching a `docs/tax-semantics.md` row, e.g. `"tax-semantics#3"` — the audit trail this
   * whole mechanism exists for (plan-v0.1 §4.4: "decisions — не украшение"). */
  readonly ruleId: string;
  readonly categoryCode: VatCategoryCode;
  readonly exemptionReasonCode?: VatexCode | undefined;
  readonly exemptionReasonText?: string | undefined;
  readonly reasoning: string;
  /**
   * T-069/D-50 point 6: what this decision covers. Every decision `decideVatCategory` produces today is
   * `{ kind: "document" }` — one category for the whole transaction, `BuildResult.decisions` carrying
   * exactly one entry. Written as an extensible union (not a bare boolean/comment) so that a future
   * per-line category resolution can add a `{ kind: "lines"; lineIdentifiers: readonly string[] }` variant
   * additively — `decisions[0]` would otherwise silently start lying the moment more than one decision
   * exists for a document, with nothing in the type forcing a caller to notice.
   */
  readonly scope: TaxDecisionScope;
}

export type TaxDecisionScope =
  | { readonly kind: "document" }
  | { readonly kind: "lines"; readonly lineIdentifiers: readonly string[] };

export interface BuildWarning {
  readonly code: string;
  readonly message: string;
}

export interface BuildResult {
  readonly invoice: import("@normwerk/einvoice-model").Invoice;
  readonly decisions: readonly TaxDecision[];
  readonly warnings: readonly BuildWarning[];
  readonly vatIdEvidence?: VatIdEvidence | undefined;
}
