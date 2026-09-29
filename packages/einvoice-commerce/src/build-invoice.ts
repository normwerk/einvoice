/**
 * T-060/T-061/T-064/W9: `buildInvoice` — commerce input → EN 16931
 * `Invoice` (`@normwerk/einvoice-model`), the actual "commerce → EN 16931"
 * bridge this package exists for (D-19/plan-v0.1 §4.4: "не просто ещё один
 * сериализатор").
 *
 * Deliberately synchronous and side-effect-free (ADR-001, ADR-003): VAT-ID
 * verification (I/O) and invoice numbering (I/O, `numbering.ts`) both
 * happen *before* this is called — `options.vatIdEvidence` and
 * `input.document.number` are the two places their results come in. This
 * function only ever throws typed errors it defines itself or propagates
 * from `decideVatCategory`; it never guesses a way around a missing fact.
 */
import {
  EinvoiceError,
  validateModel,
  type CountryCode,
  type Invoice,
  type IsoDate,
  type VatCategoryCode,
} from "@normwerk/einvoice-model";
import type { CommerceErrorCode } from "./error-codes.js";
import {
  EU_MEMBER_STATES,
  TaxRuleError,
  decideVatCategory,
  normalizeVatId,
  resolveLineRate,
} from "./tax-rules.js";
import { specialVatTerritory } from "./supported-jurisdictions.js";
import {
  apportionAmount,
  compareAmounts,
  isZeroAmount,
  multiplyToAmount,
  netsOfVatInclusiveParts,
  percentOfAmount,
  subtractAmounts,
  sumAmounts,
  unitPriceOf,
  vatContainedIn,
} from "./decimal.js";
import { validateLeitwegId } from "./leitweg-id.js";
import { validateCommerceInvoiceInput } from "./validate.js";
import type {
  BuildResult,
  BuildWarning,
  CommerceInvoiceInput,
  CommerceLine,
  CommerceParty,
  TaxDecision,
  VatIdEvidence,
} from "./types.js";

/** Same URN every fixture in this repo already uses (`fixtures/<id>/input.json`) — this package targets
 * the same XRechnung 3.0 CIUS, not a configurable choice in v0.1 (T-065's profile selection is about the
 * PDF-embedding ZUGFeRD profile, `profile.ts` — a separate axis, see that file's doc comment). */
const XRECHNUNG_SPECIFICATION_IDENTIFIER =
  "urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0";
const PEPPOL_BILLING_PROCESS_TYPE = "urn:fdc:peppol.eu:2017:poacc:billing:01:1.0";

export class UnsupportedSchemaVersionError extends EinvoiceError<CommerceErrorCode> {
  constructor(readonly received: unknown) {
    super(
      "UNSUPPORTED_SCHEMA_VERSION",
      `CommerceInvoiceInput.schemaVersion ${JSON.stringify(received)} is not supported (only 1 exists).`,
    );
    this.name = "UnsupportedSchemaVersionError";
  }
}

export class MissingCorrectedInvoiceReferenceError extends EinvoiceError<CommerceErrorCode> {
  constructor() {
    super(
      "MISSING_CORRECTED_INVOICE_REFERENCE",
      "A credit note (document.kind === 'credit-note') must carry document.correctedInvoice (BT-25/26) — " +
        "the base EN 16931 Schematron does not force this (BR-55 only fires if a preceding-invoice-reference " +
        "group exists at all, docs/tax-semantics.md row 10); this package enforces it itself.",
    );
    this.name = "MissingCorrectedInvoiceReferenceError";
  }
}

export class MissingDocumentNumberError extends EinvoiceError<CommerceErrorCode> {
  constructor() {
    super(
      "MISSING_DOCUMENT_NUMBER",
      "document.number is required — buildInvoice does not allocate one itself (ADR-001: no I/O in this " +
        "layer). Resolve one first, e.g. with numbering.ts's SequentialNumberer, then pass it in.",
    );
    this.name = "MissingDocumentNumberError";
  }
}

export class MissingDeliveryInfoForIntraCommunitySupplyError extends EinvoiceError<CommerceErrorCode> {
  constructor() {
    super(
      "MISSING_INTRA_EU_DELIVERY",
      "An intra-EU supply (category K) requires delivery.actualDeliveryDate and delivery.deliverToCountryCode " +
        "— BR-IC-11/BR-IC-12 (a real KoSIT rejection; no other category in " +
        "docs/tax-semantics.md's table needs delivery info the same way).",
    );
    this.name = "MissingDeliveryInfoForIntraCommunitySupplyError";
  }
}

export class MissingBuyerVatIdError extends EinvoiceError<CommerceErrorCode> {
  constructor() {
    super(
      "MISSING_BUYER_VAT_ID",
      "An intra-EU supply (category K) requires buyer.vatIdentifier (BT-48) on the document itself, not " +
        "just a positive VIES check — BR-IC-02 (a real KoSIT rejection): 'shall contain the Seller VAT " +
        "Identifier (BT-31) or the Seller tax representative VAT identifier (BT-63) and the Buyer VAT " +
        'identifier (BT-48)\', flag="fatal" (verified against the vendored Schematron).',
    );
    this.name = "MissingBuyerVatIdError";
  }
}

export class MissingBuyerIdentifierForReverseChargeError extends EinvoiceError<CommerceErrorCode> {
  constructor() {
    super(
      "MISSING_BUYER_IDENTIFIER_REVERSE_CHARGE",
      "A reverse-charge supply (category AE) requires buyer.vatIdentifier (BT-48) and/or " +
        "buyer.legalRegistrationIdentifier (BT-47) on the document — BR-AE-02 (a real KoSIT rejection), " +
        "which requires the buyer identifier the same way BR-IC-02 requires it for category K.",
    );
    this.name = "MissingBuyerIdentifierForReverseChargeError";
  }
}

export class MissingBuyerVatIdForCrossBorderServiceError extends EinvoiceError<CommerceErrorCode> {
  constructor() {
    super(
      "MISSING_BUYER_VAT_ID_CROSS_BORDER_SERVICE",
      "A B2B service to a business in another EU member state under reverse charge (category AE, " +
        "docs/tax-semantics.md row 12) requires buyer.vatIdentifier (BT-48): §14a Abs. 1 UStG requires the " +
        "VAT identification numbers of both parties on this invoice, and the buyer's is also needed for the " +
        "EC Sales List. A legal registration identifier (BT-47) alone satisfies BR-AE-02 but not German law.",
    );
    this.name = "MissingBuyerVatIdForCrossBorderServiceError";
  }
}

export class LineAllowanceExceedsLineAmountError extends EinvoiceError<CommerceErrorCode> {
  constructor(
    readonly lineIdentifier: string,
    readonly allowances: string,
    readonly lineAmount: string,
  ) {
    super(
      "LINE_ALLOWANCE_EXCEEDS_LINE",
      `Line ${lineIdentifier}: its discounts (${allowances}) exceed the line's own amount (${lineAmount}) — ` +
        "a line's net amount (BT-131) cannot go below zero.",
    );
    this.name = "LineAllowanceExceedsLineAmountError";
  }
}

export class InvalidLeitwegIdError extends EinvoiceError<CommerceErrorCode> {
  constructor(
    readonly value: string,
    readonly reason: string,
  ) {
    super(
      "INVALID_LEITWEG_ID",
      `references.leitwegId "${value}" is not a valid Leitweg-ID (${reason}) — KoSIT only checks that ` +
        "BT-10 is present (BR-DE-15), not its format, so a mistyped Leitweg-ID would pass KoSIT and " +
        "misroute at the receiving public-sector system.",
    );
    this.name = "InvalidLeitwegIdError";
  }
}

export class DuplicateBuyerReferenceError extends EinvoiceError<CommerceErrorCode> {
  constructor() {
    super(
      "DUPLICATE_BUYER_REFERENCE",
      "references.buyerReference and references.leitwegId both fill BT-10 (Buyer reference), which holds " +
        "one value. For a public-sector buyer, give the Leitweg-ID alone.",
    );
    this.name = "DuplicateBuyerReferenceError";
  }
}

export class MissingSellerContactError extends EinvoiceError<CommerceErrorCode> {
  constructor() {
    super(
      "MISSING_SELLER_CONTACT",
      "seller.contact (name/telephone/email) is required — every invoice this package emits declares the " +
        "XRechnung 3.0 CIUS (specificationIdentifier), whose own BR-DE-2 rule makes seller contact " +
        "mandatory regardless of buyer country (unlike the base EN 16931 Schematron).",
    );
    this.name = "MissingSellerContactError";
  }
}

export class MissingElectronicAddressError extends EinvoiceError<CommerceErrorCode> {
  constructor(readonly party: "seller" | "buyer") {
    super(
      "MISSING_ELECTRONIC_ADDRESS",
      `${party}.electronicAddress and ${party}.electronicAddressScheme are required — every invoice this ` +
        "package emits declares the XRechnung 3.0 CIUS, whose validation requires the seller's and the " +
        `buyer's electronic address with a scheme (PEPPOL-EN16931-R020/R010, BR-62/BR-63). An email address ` +
        'with scheme "EM" satisfies it.',
    );
    this.name = "MissingElectronicAddressError";
  }
}

/** §33 UStDV: the gross amount up to which an invoice may leave out the buyer's name and address. */
const SMALL_AMOUNT_INVOICE_LIMIT = "250.00";

export class InvalidPriceBasisError extends EinvoiceError<CommerceErrorCode> {
  constructor(readonly where: string) {
    super(
      "INVALID_PRICE_BASIS",
      `${where}: give exactly one of a net amount (netPrice / amount) and a VAT-inclusive one ` +
        "(priceInclVat / amountInclVat).",
    );
    this.name = "InvalidPriceBasisError";
  }
}

export class MissingSellerAddressError extends EinvoiceError<CommerceErrorCode> {
  constructor() {
    super(
      "MISSING_SELLER_ADDRESS",
      "seller.addressLine1 (street and house number, or a PO box) is required — §14 Abs. 4 Satz 1 Nr. 1 " +
        "UStG requires the seller's full address on every invoice, and §33 UStDV keeps that requirement " +
        "for small-amount invoices too. EN 16931 and the XRechnung rules leave the street optional, so " +
        "a validator would not catch its absence.",
    );
    this.name = "MissingSellerAddressError";
  }
}

export class InvalidAssembledInvoiceError extends EinvoiceError<CommerceErrorCode> {
  constructor(readonly errors: readonly string[]) {
    super(
      "INVALID_ASSEMBLED_INVOICE",
      `buildInvoice assembled an Invoice that fails validateModel(): ${errors.join("; ")}`,
    );
    this.name = "InvalidAssembledInvoiceError";
  }
}

/** T-192 (P-73): `correctedInvoiceDecision` given for an invoice. */
export class DecisionCarriedToInvoiceError extends EinvoiceError<CommerceErrorCode> {
  constructor() {
    super(
      "DECISION_CARRIED_TO_INVOICE",
      "options.correctedInvoiceDecision is for a credit note, which follows the decision of the invoice it " +
        "corrects — an invoice is decided on the facts of its own supply.",
    );
    this.name = "DecisionCarriedToInvoiceError";
  }
}

/** T-199 (P-73): a line of an invoice carries `invoicedVatRate`. */
export class InvoicedRateOnInvoiceError extends EinvoiceError<CommerceErrorCode> {
  constructor() {
    super(
      "INVOICED_RATE_ON_INVOICE",
      "lines[].invoicedVatRate is for a credit note's lines, credited at the rate the invoice they correct " +
        "stated — an invoice's lines take the rate of their own supply date.",
    );
    this.name = "InvoicedRateOnInvoiceError";
  }
}

export class InvalidPaidAmountError extends EinvoiceError<CommerceErrorCode> {
  constructor(
    readonly paidAmount: string,
    readonly total: string,
  ) {
    super(
      "INVALID_PAID_AMOUNT",
      `paidAmount ${paidAmount} (BT-113) is negative or more than the invoice total ${total} — the amount ` +
        "due (BT-115) would not be what is left to pay.",
    );
    this.name = "InvalidPaidAmountError";
  }
}

export class InvalidCommerceInvoiceInputError extends EinvoiceError<CommerceErrorCode> {
  constructor(readonly errors: readonly string[]) {
    super(
      "INVALID_INPUT",
      `input fails structural validation against the generated CommerceInvoiceInput JSON Schema ` +
        `(ADR-003): ${errors.join("; ")} — TypeScript cannot catch this for a hand-built or ` +
        "non-TypeScript payload, which is exactly the caller ADR-003 names as the reason this contract " +
        "carries an explicit schemaVersion in the first place.",
    );
    this.name = "InvalidCommerceInvoiceInputError";
  }
}

export interface BuildInvoiceOptions {
  /** Result of a `VatIdVerifier.verify()` call made *before* calling `buildInvoice` (ADR-003: this
   * function does not perform I/O itself). Only consulted when the resolved regime needs it (intra-EU
   * supply, docs/tax-semantics.md row 3). */
  readonly vatIdEvidence?: VatIdEvidence;
  /**
   * T-192 (P-73): on a credit note, the decision of the invoice it corrects — its category, exemption reason
   * and rule. The credit note then follows it instead of deciding again on today's facts: a VAT-ID that is no
   * longer valid, an OSS registration made since, an address edited since would otherwise give the credit
   * note another category than the supply it corrects (§17 UStG corrects that supply). The checks on the
   * document itself still run — a K credit note still needs the buyer's VAT-ID and a delivery to another
   * member state. Refused on an invoice (`DecisionCarriedToInvoiceError`).
   */
  readonly correctedInvoiceDecision?: TaxDecision;
}

function mapParty(party: CommerceParty) {
  return {
    name: party.name,
    countryCode: party.countryCode,
    addressLine1: party.addressLine1,
    addressLine2: party.addressLine2,
    city: party.city,
    postCode: party.postCode,
    vatIdentifier: party.vatIdentifier,
    legalRegistrationIdentifier: party.legalRegistrationIdentifier,
    electronicAddress: party.electronicAddress,
    electronicAddressScheme: party.electronicAddressScheme,
  };
}

/** P-61: whether an amount is before VAT or includes it. */
type PriceBasis = "net" | "inclusive";

/** Exactly one of a net and a VAT-inclusive amount, with which one it is. */
function amountAndBasis(
  net: string | undefined,
  inclusive: string | undefined,
  where: string,
): { readonly amount: string; readonly basis: PriceBasis } {
  if (net !== undefined && inclusive === undefined) return { amount: net, basis: "net" };
  if (inclusive !== undefined && net === undefined)
    return { amount: inclusive, basis: "inclusive" };
  throw new InvalidPriceBasisError(where);
}

interface ChargeLine {
  readonly amount: string;
  readonly vatCategoryCode: VatCategoryCode;
  readonly vatRate: string;
  readonly reason?: string | undefined;
}

/**
 * P-44: `decideVatCategory` sees only `TaxContext` — the facts the category was decided on. This checks those
 * facts against what the document itself will say, for the two categories whose legal basis depends on
 * where the goods actually go: K needs the goods to reach another member state under the buyer VAT-ID the
 * document names (§6a Abs. 1 UStG), G needs them to leave the EU (§6 Abs. 1 UStG). Without it a French
 * billing address with a German shipping address gets K, and a Swiss buyer's order delivered in Germany
 * gets G — both green in every validator, both wrong.
 */
function assertTaxFactsMatchDocument(decision: TaxDecision, input: CommerceInvoiceInput): void {
  const deliverTo = input.delivery?.deliverToCountryCode;
  if (decision.categoryCode === "K") {
    if (deliverTo === undefined || deliverTo === "DE" || !EU_MEMBER_STATES.has(deliverTo)) {
      throw new TaxRuleError(
        "DELIVERY_NOT_INTRA_EU",
        `An intra-EU supply (category K) needs the goods delivered to another EU member state (§6a Abs. 1 ` +
          `Nr. 1 UStG) — the deliver-to country (BT-80) is ${deliverTo ?? "missing"}. Refusing category K.`,
        "tax-semantics#3",
      );
    }
    const documentVatId = input.buyer.vatIdentifier;
    const decidedVatId = input.taxContext.buyerVatId;
    if (
      documentVatId !== undefined &&
      decidedVatId !== undefined &&
      normalizeVatId(documentVatId) !== normalizeVatId(decidedVatId)
    ) {
      throw new TaxRuleError(
        "BUYER_VAT_ID_MISMATCH",
        `The document's buyer VAT-ID (BT-48) ${documentVatId} is not the VAT-ID the tax decision was made ` +
          `on (${decidedVatId}) — refusing category K on a document that names a different buyer number.`,
        "tax-semantics#3",
      );
    }
  }
  if (decision.categoryCode === "G" && deliverTo !== undefined && EU_MEMBER_STATES.has(deliverTo)) {
    throw new TaxRuleError(
      "EXPORT_DELIVERED_IN_EU",
      `An export (category G) needs the goods to leave the EU (§6 Abs. 1 UStG) — they are delivered to ` +
        `${deliverTo}. A buyer outside the EU does not make a delivery inside it an export; refusing ` +
        `rather than guessing which domestic or intra-EU regime applies instead.`,
      "tax-semantics#4",
    );
  }
}

/**
 * T-195: refuses an order whose VAT turns on a territory the country code misstates — goods going to the
 * Canary Islands (ES) are exported, goods going to Northern Ireland (GB) are an intra-EU supply, and goods
 * going to Heligoland (DE) leave the German VAT area. `decideVatCategory` sees only country codes, so each of
 * these would get a category that validates and is wrong. Goods are placed where they go (the deliver-to
 * address, or the buyer's without one), a service where its buyer is; checked before the category is decided,
 * so no other refusal hides this one.
 */
function assertNotSpecialVatTerritory(input: CommerceInvoiceInput): void {
  interface Place {
    readonly what: string;
    readonly country: CountryCode;
    readonly postCode: string | undefined;
    readonly goods: boolean;
  }
  const supply = input.taxContext.supplyType;
  const buyer = {
    what: "buyer's address",
    country: input.buyer.countryCode,
    postCode: input.buyer.postCode,
  };
  const deliverTo = input.delivery?.deliverToCountryCode;
  const goodsGoTo =
    deliverTo === undefined
      ? buyer
      : {
          what: "deliver-to address (BT-80)",
          country: deliverTo,
          postCode: input.delivery?.deliverToPostCode,
        };
  const places: Place[] = [];
  if (supply !== "services") places.push({ ...goodsGoTo, goods: true });
  if (supply !== "goods") places.push({ ...buyer, goods: false });
  for (const place of places) {
    const territory = specialVatTerritory(place.country, place.postCode);
    if (territory !== undefined && (place.goods || !territory.goodsOnly)) {
      throw new TaxRuleError(
        "SPECIAL_VAT_TERRITORY",
        `The ${place.what} (${place.country} ${place.postCode ?? ""}) is in ${territory.name}, ` +
          `${territory.status}. This release does not model such territories; refusing rather than ` +
          `invoicing it as ${place.country}.`,
        "tax-semantics#special-territories",
      );
    }
  }
}

/** The category decided on the order's own facts — after the special territories are ruled out. */
function decideOnTodaysFacts(
  input: CommerceInvoiceInput,
  options: BuildInvoiceOptions,
): TaxDecision {
  assertNotSpecialVatTerritory(input);
  return decideVatCategory(input.taxContext, options.vatIdEvidence);
}

/**
 * T-203: refuses a domestic invoice on which the shop charged no VAT at all — no line of the order and not its
 * shipping carries a rate above 0 %, and no line is classified. That is a shop without a German rate in its
 * tax settings, or a Kleinunternehmer (§19 UStG): out of scope, since §34a Satz 4 UStDV lets them always send
 * an ordinary invoice instead. Each line's own refusal (0 %, no rate) would send them to the tax settings
 * alone. One untaxed line among taxed ones is a settings error and keeps its own code; so is an order whose
 * shipping alone was taxed. A credit note follows the invoice it corrects and is not checked here.
 */
function assertVatCharged(decision: TaxDecision, input: CommerceInvoiceInput): void {
  if (decision.ruleId !== "tax-semantics#1" || input.document.kind !== "invoice") return;
  // Anything but a plain zero counts as a rate here, an invalid one too: resolveLineRate refuses that itself.
  const carriesVat = (rate: string | undefined): boolean =>
    rate !== undefined && !/^0+(\.0+)?$/.test(rate.trim());
  const orderLines = input.chargeSplitLines ?? input.lines;
  if (
    orderLines.length === 0 ||
    orderLines.some((line) => line.taxRateKind !== undefined || carriesVat(line.chargedVatRate)) ||
    carriesVat(input.shipping?.chargedVatRate)
  ) {
    return;
  }
  throw new TaxRuleError(
    "NO_VAT_CHARGED",
    "The shop charged no VAT on this domestic order: no line and no shipping carries a rate above 0 %. " +
      "Either the shop's tax settings have no German VAT rate for this sale, or you are a Kleinunternehmer " +
      "(§19 UStG) — who may always send an ordinary invoice instead of an e-invoice (§34a Satz 4 UStDV) " +
      "and whom this release does not issue invoices for. Refusing rather than issuing an invoice without VAT.",
    "tax-semantics#kleinunternehmer",
  );
}

/**
 * T-199: the day the supply was made, whose rates apply — the delivery date (BT-72); for a credit note without
 * one, the date of the invoice it corrects; else the document's own date.
 */
function supplyDate(input: CommerceInvoiceInput): IsoDate {
  return (
    input.delivery?.actualDeliveryDate ??
    input.document.correctedInvoice?.issueDate ??
    input.document.issueDate
  );
}

/** `resolveLineRate` for one line, with a refusal naming the line it is about. A credit note's line credited
 * at its invoice's rate (`invoicedVatRate`) takes that rate. */
function lineRate(
  decision: TaxDecision,
  input: CommerceInvoiceInput,
  identifier: string,
  line: CommerceLine,
): string {
  if (decision.categoryCode === "S" && line.invoicedVatRate !== undefined) {
    return line.invoicedVatRate;
  }
  try {
    return resolveLineRate(
      decision,
      input.taxContext,
      line.taxRateKind,
      line.chargedVatRate,
      supplyDate(input),
    );
  } catch (error) {
    if (error instanceof TaxRuleError) {
      throw new TaxRuleError(error.code, `Line ${identifier}: ${error.message}`, error.ruleId);
    }
    throw error;
  }
}

export function buildInvoice(
  input: CommerceInvoiceInput,
  options: BuildInvoiceOptions = {},
): BuildResult {
  if (input.schemaVersion !== 1) {
    throw new UnsupportedSchemaVersionError(input.schemaVersion);
  }
  // Structural gate (T-060) before anything below touches input.document/.seller/.lines directly — a
  // hand-built or non-TypeScript payload with a missing/malformed field would otherwise crash here with a
  // raw TypeError instead of a named, listable error (ADR-003's own stated reason this contract has a
  // generated JSON Schema at all).
  const structural = validateCommerceInvoiceInput(input);
  if (!structural.valid) {
    throw new InvalidCommerceInvoiceInputError(structural.errors);
  }
  if (input.document.kind === "credit-note" && input.document.correctedInvoice === undefined) {
    throw new MissingCorrectedInvoiceReferenceError();
  }
  if (input.document.number === undefined) {
    throw new MissingDocumentNumberError();
  }
  if (input.seller.contact === undefined) {
    throw new MissingSellerContactError();
  }
  if (input.seller.addressLine1 === undefined || input.seller.addressLine1.trim() === "") {
    throw new MissingSellerAddressError();
  }
  // P-43: KoSIT rejects a document without either party's electronic address (checked against a real run:
  // a buyer without one fails PEPPOL-EN16931-R010). An order without an email reached the XML that way.
  for (const party of ["seller", "buyer"] as const) {
    const { electronicAddress, electronicAddressScheme } = input[party];
    if (!electronicAddress?.trim() || electronicAddressScheme === undefined) {
      throw new MissingElectronicAddressError(party);
    }
  }
  // P-54: a Leitweg-ID is declared, never read out of BT-10's free text — "2024-01" or a purchase order
  // number "4500123456-10" has the same shape, and was refused or routed to XRechnung for it.
  const leitwegId = input.references?.leitwegId;
  if (leitwegId !== undefined) {
    if (input.references?.buyerReference !== undefined) {
      throw new DuplicateBuyerReferenceError();
    }
    const leitwegIdResult = validateLeitwegId(leitwegId);
    if (!leitwegIdResult.valid) {
      throw new InvalidLeitwegIdError(leitwegId, leitwegIdResult.reason ?? "unknown");
    }
  }

  const warnings: BuildWarning[] = [];
  if (input.payment?.terms !== undefined) {
    // No BT-20 (payment terms free text) field exists in @normwerk/einvoice-model yet — surfaced as a
    // warning rather than silently dropped, so a caller relying on it notices instead of finding out from
    // a missing field on the rendered document.
    warnings.push({
      code: "payment-terms-not-mapped",
      message:
        "input.payment.terms has no equivalent field in the current Invoice model (BT-20 unmapped) — dropped.",
    });
  }
  if (
    input.references?.orderReference !== undefined ||
    input.references?.contractReference !== undefined
  ) {
    // BT-13 (order reference) / BT-12 (contract reference) — also not modeled yet; same honesty as
    // payment.terms above rather than a field that silently goes nowhere.
    warnings.push({
      code: "order-contract-reference-not-mapped",
      message:
        "input.references.orderReference/contractReference have no equivalent field in the current Invoice model (BT-13/BT-12 unmapped) — dropped.",
    });
  }
  if (input.customs !== undefined) {
    // BT-158 (lines[].hsCode) and BT-159 (lines[].originCountry) ARE mapped as of T-060 continuation
    // (D-19) — see the `lines:` assembly below. `input.customs` itself (incoterm/sellerEori/buyerEori/
    // iossNumber) is a *different*, still-unmapped block: none of those four have an equivalent field in
    // the current Invoice model (no dedicated BT in this package's v0.1 scope maps them).
    warnings.push({
      code: "customs-not-mapped",
      message:
        "input.customs (incoterm/sellerEori/buyerEori/iossNumber) has no equivalent field in the current Invoice model — dropped. (BT-158/BT-159, lines[].hsCode/originCountry, ARE mapped — see per-line output.)",
    });
  }

  if (options.correctedInvoiceDecision !== undefined && input.document.kind !== "credit-note") {
    throw new DecisionCarriedToInvoiceError();
  }
  if (
    input.document.kind !== "credit-note" &&
    [...input.lines, ...(input.chargeSplitLines ?? [])].some(
      (line) => line.invoicedVatRate !== undefined,
    )
  ) {
    throw new InvoicedRateOnInvoiceError();
  }
  const regimeDecision: TaxDecision =
    options.correctedInvoiceDecision ?? decideOnTodaysFacts(input, options);
  const decisions: TaxDecision[] = [regimeDecision];

  if (
    regimeDecision.categoryCode === "K" &&
    (input.delivery?.actualDeliveryDate === undefined ||
      input.delivery?.deliverToCountryCode === undefined)
  ) {
    throw new MissingDeliveryInfoForIntraCommunitySupplyError();
  }
  if (regimeDecision.categoryCode === "K" && input.buyer.vatIdentifier === undefined) {
    throw new MissingBuyerVatIdError();
  }
  if (
    regimeDecision.categoryCode === "AE" &&
    input.buyer.vatIdentifier === undefined &&
    input.buyer.legalRegistrationIdentifier === undefined
  ) {
    throw new MissingBuyerIdentifierForReverseChargeError();
  }
  if (regimeDecision.ruleId === "tax-semantics#12" && input.buyer.vatIdentifier === undefined) {
    throw new MissingBuyerVatIdForCrossBorderServiceError();
  }
  assertTaxFactsMatchDocument(regimeDecision, input);
  assertVatCharged(regimeDecision, input);

  // P-61: every price and amount is either net or VAT-inclusive (exactly one of the two fields).
  const computeLine = (line: CommerceLine, index: number) => {
    const identifier = line.identifier ?? String(index + 1);
    const price = amountAndBasis(line.netPrice, line.priceInclVat, `line ${identifier}`);
    const amountBeforeAllowances = multiplyToAmount(line.quantity, price.amount);
    const allowances = line.allowances ?? [];
    const sumOfLineAllowances = sumAmounts(allowances.map((a) => a.amount));
    if (compareAmounts(sumOfLineAllowances, amountBeforeAllowances) > 0) {
      throw new LineAllowanceExceedsLineAmountError(
        identifier,
        sumOfLineAllowances,
        amountBeforeAllowances,
      );
    }
    return {
      identifier,
      basis: price.basis,
      amount: subtractAmounts(amountBeforeAllowances, sumOfLineAllowances),
      rate: lineRate(regimeDecision, input, identifier, line),
      line,
    };
  };
  const lineComputations = input.lines.map(computeLine);
  // P-67: the lines whose rates and amounts split the charges — the whole supply's, when the document
  // invoices part of it.
  const splitComputations =
    input.chargeSplitLines === undefined
      ? lineComputations
      : input.chargeSplitLines.map(computeLine);
  const shipping =
    input.shipping !== undefined
      ? {
          ...amountAndBasis(input.shipping.amount, input.shipping.amountInclVat, "shipping"),
          reason: input.shipping.reason,
        }
      : undefined;
  const discounts = (input.discounts ?? []).map((discount, index) => ({
    ...amountAndBasis(discount.amount, discount.amountInclVat, `discount ${index + 1}`),
    reason: discount.reason,
  }));

  // Document-level shipping and discounts: the VAT category of the overall regime and — for category S — the
  // rate of the supply they belong to. Shipping charged by the seller is an ancillary supply that shares
  // the main supply's rate (Art. 78(b) VAT Directive, §10 Abs. 1 UStG, UStAE 3.10 Abs. 5), and a discount
  // reduces the base of the supplies it relates to (§17 UStG): a basket with a single line rate (all 7%,
  // all 19%, or an OSS destination rate) takes exactly that rate (P-40). A basket that mixes rates holds
  // supplies at each of them, so each amount is split across the rates in proportion to the lines' net
  // amounts at each rate, after their own allowances (P-65, M-039; UStAE 10.1 Abs. 11 by analogy): one
  // BG-21/BG-20 per rate, the cents left over by largest remainder (`apportionAmount`). A VAT-inclusive
  // amount is split gross; each rate's VAT is taken out of its share with the rest of that rate's group.
  const lineRates = [...new Set(splitComputations.map((l) => l.rate))];
  const lineNetOfRate = (rate: string): string => {
    const ofRate = splitComputations.filter((l) => l.rate === rate);
    const net = sumAmounts(ofRate.filter((l) => l.basis === "net").map((l) => l.amount));
    const inclusive = sumAmounts(
      ofRate.filter((l) => l.basis === "inclusive").map((l) => l.amount),
    );
    return sumAmounts([net, subtractAmounts(inclusive, vatContainedIn(inclusive, rate))]);
  };
  interface DocumentPiece {
    readonly rate: string;
    readonly amount: string;
    readonly basis: PriceBasis;
    readonly reason?: string | undefined;
  }
  const apportionAcrossLineRates = (
    charge: {
      readonly amount: string;
      readonly basis: PriceBasis;
      readonly reason?: string | undefined;
    },
    what: string,
  ): DocumentPiece[] => {
    const [onlyRate] = lineRates;
    if (lineRates.length === 1 && onlyRate !== undefined) {
      return [
        { rate: onlyRate, amount: charge.amount, basis: charge.basis, reason: charge.reason },
      ];
    }
    const weights = lineRates.map(lineNetOfRate);
    if (weights.every(isZeroAmount)) {
      throw new TaxRuleError(
        "CHARGE_SPLIT_IMPOSSIBLE",
        `The ${what} cannot be split across the invoice's VAT rates: its lines add up to zero at every ` +
          "rate, so there is no proportion to split it in.",
        "tax-semantics#9",
      );
    }
    const shares = apportionAmount(charge.amount, weights);
    return lineRates.flatMap((rate, index) => {
      const share = shares[index] as string;
      const perRate = `anteilig ${rate} %`;
      return isZeroAmount(share)
        ? []
        : [
            {
              rate,
              amount: share,
              basis: charge.basis,
              reason: charge.reason === undefined ? perRate : `${charge.reason} (${perRate})`,
            },
          ];
    });
  };
  const chargePieces: DocumentPiece[] =
    shipping !== undefined ? apportionAcrossLineRates(shipping, "shipping") : [];
  const allowancePieces: DocumentPiece[] = discounts.flatMap((discount, index) =>
    apportionAcrossLineRates(discount, `discount ${index + 1}`),
  );

  // BG-23 VAT breakdown: group by (category, rate) — a domestic (S) document can have more than one group
  // (docs/tax-semantics.md row 9, mixed rates); every other regime is uniform, so exactly one group. A
  // group's net-priced parts are taxed as they are (BR-CO-17); its VAT-inclusive parts keep their gross
  // total — the VAT is taken out of it and the net spread back over them (P-61).
  interface PartRef {
    readonly kind: "line" | "charge" | "allowance";
    readonly index: number;
  }
  interface GroupPart {
    readonly ref: PartRef;
    readonly amount: string;
    readonly basis: PriceBasis;
    readonly negative: boolean;
  }
  const groupParts = new Map<string, GroupPart[]>();
  const addPart = (rate: string, part: GroupPart): void => {
    groupParts.set(rate, [...(groupParts.get(rate) ?? []), part]);
  };
  lineComputations.forEach((lc, index) =>
    addPart(lc.rate, {
      ref: { kind: "line", index },
      amount: lc.amount,
      basis: lc.basis,
      negative: false,
    }),
  );
  chargePieces.forEach((piece, index) =>
    addPart(piece.rate, {
      ref: { kind: "charge", index },
      amount: piece.amount,
      basis: piece.basis,
      negative: false,
    }),
  );
  allowancePieces.forEach((piece, index) =>
    addPart(piece.rate, {
      ref: { kind: "allowance", index },
      amount: piece.amount,
      basis: piece.basis,
      negative: true,
    }),
  );

  const lineNets: string[] = lineComputations.map((lc) => lc.amount);
  const chargeNets: string[] = chargePieces.map((piece) => piece.amount);
  const allowanceNets: string[] = allowancePieces.map((piece) => piece.amount);
  const netsOf: Record<PartRef["kind"], string[]> = {
    line: lineNets,
    charge: chargeNets,
    allowance: allowanceNets,
  };
  const signedSum = (parts: readonly GroupPart[]): string =>
    subtractAmounts(
      sumAmounts(parts.filter((p) => !p.negative).map((p) => p.amount)),
      sumAmounts(parts.filter((p) => p.negative).map((p) => p.amount)),
    );
  const vatBreakdown = Array.from(groupParts.entries()).map(([rate, parts]) => {
    const netPart = signedSum(parts.filter((p) => p.basis === "net"));
    const inclusiveParts = parts.filter((p) => p.basis === "inclusive");
    const inclusiveTotal = signedSum(inclusiveParts);
    const inclusiveVat = vatContainedIn(inclusiveTotal, rate);
    const inclusiveNet = subtractAmounts(inclusiveTotal, inclusiveVat);
    const nets = netsOfVatInclusiveParts(inclusiveParts, rate, inclusiveNet);
    inclusiveParts.forEach((part, k) => {
      netsOf[part.ref.kind][part.ref.index] = nets[k] as string;
    });
    const taxableAmount = sumAmounts([netPart, inclusiveNet]);
    return {
      taxableAmount,
      taxAmount: sumAmounts([percentOfAmount(netPart, rate), inclusiveVat]),
      categoryCode: regimeDecision.categoryCode,
      rate,
      exemptionReasonCode:
        regimeDecision.categoryCode === "S" ? undefined : regimeDecision.exemptionReasonCode,
      exemptionReasonText:
        regimeDecision.categoryCode === "S" ? undefined : regimeDecision.exemptionReasonText,
    };
  });

  const documentLevelCharges: ChargeLine[] = chargePieces.map((piece, index) => ({
    amount: chargeNets[index] as string,
    vatCategoryCode: regimeDecision.categoryCode,
    vatRate: piece.rate,
    reason: piece.reason,
  }));
  const documentLevelAllowances: ChargeLine[] = allowancePieces.map((piece, index) => ({
    amount: allowanceNets[index] as string,
    vatCategoryCode: regimeDecision.categoryCode,
    vatRate: piece.rate,
    reason: piece.reason,
  }));

  const sumOfLineNetAmounts = sumAmounts(lineNets);
  const sumOfCharges =
    documentLevelCharges.length > 0
      ? sumAmounts(documentLevelCharges.map((c) => c.amount))
      : undefined;
  const sumOfAllowances =
    documentLevelAllowances.length > 0
      ? sumAmounts(documentLevelAllowances.map((a) => a.amount))
      : undefined;

  let totalAmountWithoutVat = sumOfLineNetAmounts;
  if (sumOfCharges !== undefined)
    totalAmountWithoutVat = sumAmounts([totalAmountWithoutVat, sumOfCharges]);
  if (sumOfAllowances !== undefined)
    totalAmountWithoutVat = subtractAmounts(totalAmountWithoutVat, sumOfAllowances);

  const totalVatAmount = sumAmounts(vatBreakdown.map((g) => g.taxAmount));
  const totalAmountWithVat = sumAmounts([totalAmountWithoutVat, totalVatAmount]);
  // P-67: BT-115 is what is left after what the buyer already paid (BT-113).
  const paidAmount = input.paidAmount;
  if (
    paidAmount !== undefined &&
    (compareAmounts(paidAmount, "0.00") < 0 || compareAmounts(paidAmount, totalAmountWithVat) > 0)
  ) {
    throw new InvalidPaidAmountError(paidAmount, totalAmountWithVat);
  }
  const amountDueForPayment =
    paidAmount === undefined ? totalAmountWithVat : subtractAmounts(totalAmountWithVat, paidAmount);

  // §14 Abs. 4 Satz 1 Nr. 1 UStG needs the buyer's full address too, except on a small-amount invoice
  // (§33 UStDV: up to EUR 250 including VAT). The street cannot be made up here, so it is a warning.
  const buyerStreet = input.buyer.addressLine1;
  if (
    (buyerStreet === undefined || buyerStreet.trim() === "") &&
    compareAmounts(totalAmountWithVat, SMALL_AMOUNT_INVOICE_LIMIT) > 0
  ) {
    warnings.push({
      code: "buyer-street-missing",
      message:
        `The buyer's address has no street line (BT-50). Above EUR ${SMALL_AMOUNT_INVOICE_LIMIT} including ` +
        "VAT, §14 Abs. 4 Satz 1 Nr. 1 UStG requires the buyer's full address on the invoice.",
    });
  }

  const invoice: Invoice = {
    number: input.document.number,
    issueDate: input.document.issueDate,
    typeCode: input.document.kind === "credit-note" ? "381" : "380",
    currencyCode: input.document.currency,
    specificationIdentifier: XRECHNUNG_SPECIFICATION_IDENTIFIER,
    businessProcessType: PEPPOL_BILLING_PROCESS_TYPE,
    buyerReference: leitwegId ?? input.references?.buyerReference,
    precedingInvoiceReferences:
      input.document.correctedInvoice !== undefined
        ? [
            {
              invoiceNumber: input.document.correctedInvoice.number,
              issueDate: input.document.correctedInvoice.issueDate,
            },
          ]
        : undefined,
    seller: { ...mapParty(input.seller), contact: input.seller.contact },
    buyer: mapParty(input.buyer),
    delivery: input.delivery,
    paymentInstructions:
      input.payment !== undefined
        ? { meansTypeCode: input.payment.means, accountIdentifier: input.payment.iban }
        : undefined,
    documentLevelAllowances:
      documentLevelAllowances.length > 0
        ? documentLevelAllowances.map((a) => ({
            amount: a.amount,
            vatCategoryCode: a.vatCategoryCode,
            vatRate: a.vatRate,
            reason: a.reason,
          }))
        : undefined,
    documentLevelCharges:
      documentLevelCharges.length > 0
        ? documentLevelCharges.map((c) => ({
            amount: c.amount,
            vatCategoryCode: c.vatCategoryCode,
            vatRate: c.vatRate,
            reason: c.reason,
          }))
        : undefined,
    totals: {
      sumOfLineNetAmounts,
      sumOfAllowances,
      sumOfCharges,
      totalAmountWithoutVat,
      totalVatAmount,
      totalAmountWithVat,
      paidAmount,
      amountDueForPayment,
    },
    vatBreakdown,
    lines: lineComputations.map((lc, index) => {
      const netAmount = lineNets[index] as string;
      // A VAT-inclusive line (P-61): its allowances' nets and its net unit price follow from its share of
      // the group's net, so quantity × price − allowances still gives the line's net amount (BT-131).
      const allowances =
        lc.basis === "net"
          ? (lc.line.allowances ?? [])
          : (lc.line.allowances ?? []).map((a) => ({
              amount: subtractAmounts(a.amount, vatContainedIn(a.amount, lc.rate)),
              reason: a.reason,
            }));
      const netPrice =
        lc.basis === "net"
          ? (lc.line.netPrice as string)
          : unitPriceOf(
              sumAmounts([netAmount, ...allowances.map((a) => a.amount)]),
              lc.line.quantity,
            );
      return {
        identifier: lc.identifier,
        quantity: lc.line.quantity,
        unitCode: lc.line.unitCode,
        netAmount,
        netPrice,
        itemName: lc.line.itemName,
        allowances:
          allowances.length > 0
            ? allowances.map((a) => ({ amount: a.amount, reason: a.reason }))
            : undefined,
        vat: { categoryCode: regimeDecision.categoryCode, rate: lc.rate },
        // BT-158/BT-159 (T-060 continuation, D-19) — undefined passes through untouched, same as every
        // other optional field here; @normwerk/einvoice-cii's plan skips the whole DesignatedProductClassification
        // / OriginTradeCountry element when its source field is undefined (plan.ts's own `from` semantics).
        hsCode: lc.line.hsCode,
        originCountry: lc.line.originCountry,
      };
    }),
  };

  const validation = validateModel(invoice);
  if (!validation.valid) {
    throw new InvalidAssembledInvoiceError(validation.errors);
  }

  return { invoice, decisions, warnings, vatIdEvidence: options.vatIdEvidence };
}
