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
import { validateModel, type Invoice, type VatCategoryCode } from "@normwerk/einvoice-model";
import {
  DE_STANDARD_RATE,
  EU_MEMBER_STATES,
  TaxRuleError,
  decideVatCategory,
  normalizeVatId,
  resolveLineRate,
} from "./tax-rules.js";
import {
  compareAmounts,
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

export class UnsupportedSchemaVersionError extends Error {
  constructor(readonly received: unknown) {
    super(
      `CommerceInvoiceInput.schemaVersion ${JSON.stringify(received)} is not supported (only 1 exists).`,
    );
    this.name = "UnsupportedSchemaVersionError";
  }
}

export class MissingCorrectedInvoiceReferenceError extends Error {
  constructor() {
    super(
      "A credit note (document.kind === 'credit-note') must carry document.correctedInvoice (BT-25/26) — " +
        "the base EN 16931 Schematron does not force this (BR-55 only fires if a preceding-invoice-reference " +
        "group exists at all, docs/tax-semantics.md row 10); this package enforces it itself.",
    );
    this.name = "MissingCorrectedInvoiceReferenceError";
  }
}

export class MissingDocumentNumberError extends Error {
  constructor() {
    super(
      "document.number is required — buildInvoice does not allocate one itself (ADR-001: no I/O in this " +
        "layer). Resolve one first, e.g. with numbering.ts's SequentialNumberer, then pass it in.",
    );
    this.name = "MissingDocumentNumberError";
  }
}

export class MissingDeliveryInfoForIntraCommunitySupplyError extends Error {
  constructor() {
    super(
      "An intra-EU supply (category K) requires delivery.actualDeliveryDate and delivery.deliverToCountryCode " +
        "— BR-IC-11/BR-IC-12 (a real KoSIT rejection; no other category in " +
        "docs/tax-semantics.md's table needs delivery info the same way).",
    );
    this.name = "MissingDeliveryInfoForIntraCommunitySupplyError";
  }
}

export class MissingBuyerVatIdError extends Error {
  constructor() {
    super(
      "An intra-EU supply (category K) requires buyer.vatIdentifier (BT-48) on the document itself, not " +
        "just a positive VIES check — BR-IC-02 (a real KoSIT rejection): 'shall contain the Seller VAT " +
        "Identifier (BT-31) or the Seller tax representative VAT identifier (BT-63) and the Buyer VAT " +
        'identifier (BT-48)\', flag="fatal" (verified against the vendored Schematron).',
    );
    this.name = "MissingBuyerVatIdError";
  }
}

export class MissingBuyerIdentifierForReverseChargeError extends Error {
  constructor() {
    super(
      "A reverse-charge supply (category AE) requires buyer.vatIdentifier (BT-48) and/or " +
        "buyer.legalRegistrationIdentifier (BT-47) on the document — BR-AE-02 (a real KoSIT rejection), " +
        "which requires the buyer identifier the same way BR-IC-02 requires it for category K.",
    );
    this.name = "MissingBuyerIdentifierForReverseChargeError";
  }
}

export class MissingBuyerVatIdForCrossBorderServiceError extends Error {
  constructor() {
    super(
      "A B2B service to a business in another EU member state under reverse charge (category AE, " +
        "docs/tax-semantics.md row 12) requires buyer.vatIdentifier (BT-48): §14a Abs. 1 UStG requires the " +
        "VAT identification numbers of both parties on this invoice, and the buyer's is also needed for the " +
        "EC Sales List. A legal registration identifier (BT-47) alone satisfies BR-AE-02 but not German law.",
    );
    this.name = "MissingBuyerVatIdForCrossBorderServiceError";
  }
}

export class LineAllowanceExceedsLineAmountError extends Error {
  constructor(
    readonly lineIdentifier: string,
    readonly allowances: string,
    readonly lineAmount: string,
  ) {
    super(
      `Line ${lineIdentifier}: its discounts (${allowances}) exceed the line's own amount (${lineAmount}) — ` +
        "a line's net amount (BT-131) cannot go below zero.",
    );
    this.name = "LineAllowanceExceedsLineAmountError";
  }
}

export class InvalidLeitwegIdError extends Error {
  constructor(
    readonly value: string,
    readonly reason: string,
  ) {
    super(
      `references.leitwegId "${value}" is not a valid Leitweg-ID (${reason}) — KoSIT only checks that ` +
        "BT-10 is present (BR-DE-15), not its format, so a mistyped Leitweg-ID would pass KoSIT and " +
        "misroute at the receiving public-sector system.",
    );
    this.name = "InvalidLeitwegIdError";
  }
}

export class DuplicateBuyerReferenceError extends Error {
  constructor() {
    super(
      "references.buyerReference and references.leitwegId both fill BT-10 (Buyer reference), which holds " +
        "one value. For a public-sector buyer, give the Leitweg-ID alone.",
    );
    this.name = "DuplicateBuyerReferenceError";
  }
}

export class MissingSellerContactError extends Error {
  constructor() {
    super(
      "seller.contact (name/telephone/email) is required — every invoice this package emits declares the " +
        "XRechnung 3.0 CIUS (specificationIdentifier), whose own BR-DE-2 rule makes seller contact " +
        "mandatory regardless of buyer country (unlike the base EN 16931 Schematron).",
    );
    this.name = "MissingSellerContactError";
  }
}

export class MissingElectronicAddressError extends Error {
  constructor(readonly party: "seller" | "buyer") {
    super(
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

export class InvalidPriceBasisError extends Error {
  constructor(readonly where: string) {
    super(
      `${where}: give exactly one of a net amount (netPrice / amount) and a VAT-inclusive one ` +
        "(priceInclVat / amountInclVat).",
    );
    this.name = "InvalidPriceBasisError";
  }
}

export class MissingSellerAddressError extends Error {
  constructor() {
    super(
      "seller.addressLine1 (street and house number, or a PO box) is required — §14 Abs. 4 Satz 1 Nr. 1 " +
        "UStG requires the seller's full address on every invoice, and §33 UStDV keeps that requirement " +
        "for small-amount invoices too. EN 16931 and the XRechnung rules leave the street optional, so " +
        "a validator would not catch its absence.",
    );
    this.name = "MissingSellerAddressError";
  }
}

export class InvalidAssembledInvoiceError extends Error {
  constructor(readonly errors: readonly string[]) {
    super(`buildInvoice assembled an Invoice that fails validateModel(): ${errors.join("; ")}`);
    this.name = "InvalidAssembledInvoiceError";
  }
}

export class InvalidCommerceInvoiceInputError extends Error {
  constructor(readonly errors: readonly string[]) {
    super(
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
        `The document's buyer VAT-ID (BT-48) ${documentVatId} is not the VAT-ID the tax decision was made ` +
          `on (${decidedVatId}) — refusing category K on a document that names a different buyer number.`,
        "tax-semantics#3",
      );
    }
  }
  if (decision.categoryCode === "G" && deliverTo !== undefined && EU_MEMBER_STATES.has(deliverTo)) {
    throw new TaxRuleError(
      `An export (category G) needs the goods to leave the EU (§6 Abs. 1 UStG) — they are delivered to ` +
        `${deliverTo}. A buyer outside the EU does not make a delivery inside it an export; refusing ` +
        `rather than guessing which domestic or intra-EU regime applies instead.`,
      "tax-semantics#4",
    );
  }
}

/** `resolveLineRate` for one line, with a refusal naming the line it is about. */
function lineRate(
  decision: TaxDecision,
  input: CommerceInvoiceInput,
  identifier: string,
  line: CommerceLine,
): string {
  try {
    return resolveLineRate(decision, input.taxContext, line.taxRateKind, line.chargedVatRate);
  } catch (error) {
    if (error instanceof TaxRuleError) {
      throw new TaxRuleError(`Line ${identifier}: ${error.message}`, error.ruleId);
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

  const regimeDecision: TaxDecision = decideVatCategory(input.taxContext, options.vatIdEvidence);
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

  // P-61: every price and amount is either net or VAT-inclusive (exactly one of the two fields).
  const lineComputations = input.lines.map((line, index) => {
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
  });
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

  // Document-level shipping/discounts: same VAT category as the overall regime, and — for category S — the
  // rate of the supply they belong to. Shipping charged by the seller is an ancillary supply that shares
  // the main supply's rate (Art. 78(b) VAT Directive, §10 Abs. 1 UStG, UStAE 3.10 Abs. 5), and a discount
  // reduces the base of the supplies it relates to (§17 UStG) — so a basket with a single line rate
  // (all 7%, all 19%, or an OSS destination rate) takes exactly that rate (P-40). Only a basket that mixes
  // rates has no single answer: splitting the amount across rates is an open decision (M-039), so until it's
  // made the amount stays at the standard rate, with a warning, as before.
  const lineRates = new Set(lineComputations.map((l) => l.rate));
  const singleLineRate = lineRates.size === 1 ? lineComputations[0]?.rate : undefined;
  const chargeCategoryRate =
    regimeDecision.categoryCode !== "S" ? "0" : (singleLineRate ?? DE_STANDARD_RATE);
  if (
    regimeDecision.categoryCode === "S" &&
    singleLineRate === undefined &&
    (input.shipping !== undefined || (input.discounts ?? []).length > 0)
  ) {
    warnings.push({
      code: "shipping-discount-rate-assumption",
      message:
        "This invoice mixes VAT rates across its lines; its shipping/discounts are taxed at the standard " +
        "rate, not apportioned across the rates of the lines they relate to.",
    });
  }

  // BG-23 VAT breakdown: group by (category, rate) — a domestic (S) document can have more than one group
  // (docs/tax-semantics.md row 9, mixed rates); every other regime is uniform, so exactly one group. A
  // group's net-priced parts are taxed as they are (BR-CO-17); its VAT-inclusive parts keep their gross
  // total — the VAT is taken out of it and the net spread back over them (P-61).
  type PartRef =
    { readonly kind: "line" | "discount"; readonly index: number } | { readonly kind: "shipping" };
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
  if (shipping !== undefined) {
    addPart(chargeCategoryRate, {
      ref: { kind: "shipping" },
      amount: shipping.amount,
      basis: shipping.basis,
      negative: false,
    });
  }
  discounts.forEach((discount, index) =>
    addPart(chargeCategoryRate, {
      ref: { kind: "discount", index },
      amount: discount.amount,
      basis: discount.basis,
      negative: true,
    }),
  );

  const lineNets: string[] = lineComputations.map((lc) => lc.amount);
  let shippingNet = shipping?.amount;
  const discountNets: string[] = discounts.map((discount) => discount.amount);
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
      const net = nets[k] as string;
      if (part.ref.kind === "line") lineNets[part.ref.index] = net;
      else if (part.ref.kind === "discount") discountNets[part.ref.index] = net;
      else shippingNet = net;
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

  const documentLevelCharges: ChargeLine[] =
    shipping !== undefined && shippingNet !== undefined
      ? [
          {
            amount: shippingNet,
            vatCategoryCode: regimeDecision.categoryCode,
            vatRate: chargeCategoryRate,
            reason: shipping.reason,
          },
        ]
      : [];
  const documentLevelAllowances: ChargeLine[] = discounts.map((discount, index) => ({
    amount: discountNets[index] as string,
    vatCategoryCode: regimeDecision.categoryCode,
    vatRate: chargeCategoryRate,
    reason: discount.reason,
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
  const amountDueForPayment = totalAmountWithVat;

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
