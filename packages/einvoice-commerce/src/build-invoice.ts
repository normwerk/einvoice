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
import { multiplyToAmount, percentOfAmount, subtractAmounts, sumAmounts } from "./decimal.js";
import {
  DE_STANDARD_RATE,
  EU_MEMBER_STATES,
  TaxRuleError,
  decideVatCategory,
  normalizeVatId,
  resolveLineRate,
} from "./tax-rules.js";
import { looksLikeLeitwegId, validateLeitwegId } from "./leitweg-id.js";
import { validateCommerceInvoiceInput } from "./validate.js";
import type {
  BuildResult,
  BuildWarning,
  CommerceInvoiceInput,
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
        "group exists at all, docs/tax-semantics.md row 10); this package enforces it itself (T-064).",
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
        "— BR-IC-11/BR-IC-12 (real KoSIT rejection, T-060 continuation; no other category in " +
        "docs/tax-semantics.md's table needs delivery info the same way).",
    );
    this.name = "MissingDeliveryInfoForIntraCommunitySupplyError";
  }
}

export class MissingBuyerVatIdError extends Error {
  constructor() {
    super(
      "An intra-EU supply (category K) requires buyer.vatIdentifier (BT-48) on the document itself, not " +
        "just a positive VIES check — BR-IC-02 (P-19, real KoSIT rejection): 'shall contain the Seller VAT " +
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
        "buyer.legalRegistrationIdentifier (BT-47) on the document — BR-AE-02 (P-19, real KoSIT rejection), " +
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

export class InvalidLeitwegIdError extends Error {
  constructor(
    readonly value: string,
    readonly reason: string,
  ) {
    super(
      `references.buyerReference "${value}" has the shape of a Leitweg-ID but fails validation (${reason}) ` +
        "— KoSIT's own validator only checks that BT-10 is present (BR-DE-15), not its format, so a " +
        "mistyped Leitweg-ID would otherwise pass KoSIT and misroute at the receiving public-sector system " +
        "(T-062).",
    );
    this.name = "InvalidLeitwegIdError";
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
        `(T-060, ADR-003): ${errors.join("; ")} — TypeScript cannot catch this for a hand-built or ` +
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
    city: party.city,
    postCode: party.postCode,
    vatIdentifier: party.vatIdentifier,
    legalRegistrationIdentifier: party.legalRegistrationIdentifier,
    electronicAddress: party.electronicAddress,
    electronicAddressScheme: party.electronicAddressScheme,
  };
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
  const buyerReference = input.references?.buyerReference;
  if (buyerReference !== undefined && looksLikeLeitwegId(buyerReference)) {
    // Only validated when it has the shape at all (T-062) — an ordinary free-text B2B reference that
    // doesn't look like a Leitweg-ID is not a malformed one, it's simply not one; BT-10 is valid free text
    // in general, not exclusively for German public-sector buyers.
    const leitwegIdResult = validateLeitwegId(buyerReference);
    if (!leitwegIdResult.valid) {
      throw new InvalidLeitwegIdError(buyerReference, leitwegIdResult.reason ?? "unknown");
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

  const lineComputations = input.lines.map((line, index) => ({
    identifier: line.identifier ?? String(index + 1),
    netAmount: multiplyToAmount(line.quantity, line.netPrice),
    rate: resolveLineRate(regimeDecision, input.taxContext, line.taxRateKind),
    line,
  }));

  const sumOfLineNetAmounts = sumAmounts(lineComputations.map((l) => l.netAmount));

  // Document-level shipping/discounts: same VAT category as the overall regime; for a domestic-standard-
  // rate (S) document they default to the standard rate (the common real-world convention — shipping is
  // ordinarily charged at the standard rate regardless of a mixed-rate line basket), not apportioned
  // per-line. A mixed-rate document with a discount that must instead follow the *reduced*-rate lines is
  // out of v0.1 scope; document as much rather than silently mis-taxing it.
  const chargeCategoryRate = regimeDecision.categoryCode === "S" ? DE_STANDARD_RATE : "0";
  if (regimeDecision.categoryCode === "S" && input.lines.some((l) => l.taxRateKind === "reduced")) {
    warnings.push({
      code: "shipping-discount-rate-assumption",
      message:
        "This invoice mixes standard- and reduced-rate lines; shipping/discounts (if any) are taxed at " +
        "the standard rate by default, not apportioned across rates.",
    });
  }

  const documentLevelCharges: ChargeLine[] =
    input.shipping !== undefined
      ? [
          {
            amount: input.shipping.amount,
            vatCategoryCode: regimeDecision.categoryCode,
            vatRate: chargeCategoryRate,
            reason: input.shipping.reason,
          },
        ]
      : [];
  const documentLevelAllowances: ChargeLine[] = (input.discounts ?? []).map((discount) => ({
    amount: discount.amount,
    vatCategoryCode: regimeDecision.categoryCode,
    vatRate: chargeCategoryRate,
    reason: discount.reason,
  }));

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

  // BG-23 VAT breakdown: group by (category, rate) — a domestic (S) document can have more than one group
  // (docs/tax-semantics.md row 9, mixed rates); every other regime is uniform, so exactly one group.
  const groups = new Map<string, { readonly rate: string; netAmount: string }>();
  for (const lc of lineComputations) {
    const key = lc.rate;
    const existing = groups.get(key);
    groups.set(key, {
      rate: lc.rate,
      netAmount: sumAmounts([existing?.netAmount ?? "0", lc.netAmount]),
    });
  }
  if (documentLevelCharges.length > 0 || documentLevelAllowances.length > 0) {
    const key = chargeCategoryRate;
    const existing = groups.get(key) ?? { rate: chargeCategoryRate, netAmount: "0" };
    let adjusted = existing.netAmount;
    if (sumOfCharges !== undefined) adjusted = sumAmounts([adjusted, sumOfCharges]);
    if (sumOfAllowances !== undefined) adjusted = subtractAmounts(adjusted, sumOfAllowances);
    groups.set(key, { rate: chargeCategoryRate, netAmount: adjusted });
  }

  const vatBreakdown = Array.from(groups.values()).map((group) => ({
    taxableAmount: group.netAmount,
    taxAmount: percentOfAmount(group.netAmount, group.rate),
    categoryCode: regimeDecision.categoryCode,
    rate: group.rate,
    exemptionReasonCode:
      regimeDecision.categoryCode === "S" ? undefined : regimeDecision.exemptionReasonCode,
    exemptionReasonText:
      regimeDecision.categoryCode === "S" ? undefined : regimeDecision.exemptionReasonText,
  }));

  const totalVatAmount = sumAmounts(vatBreakdown.map((g) => g.taxAmount));
  const totalAmountWithVat = sumAmounts([totalAmountWithoutVat, totalVatAmount]);
  const amountDueForPayment = totalAmountWithVat;

  const invoice: Invoice = {
    number: input.document.number,
    issueDate: input.document.issueDate,
    typeCode: input.document.kind === "credit-note" ? "381" : "380",
    currencyCode: input.document.currency,
    specificationIdentifier: XRECHNUNG_SPECIFICATION_IDENTIFIER,
    businessProcessType: PEPPOL_BILLING_PROCESS_TYPE,
    buyerReference: input.references?.buyerReference,
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
    lines: lineComputations.map((lc) => ({
      identifier: lc.identifier,
      quantity: lc.line.quantity,
      unitCode: lc.line.unitCode,
      netAmount: lc.netAmount,
      netPrice: lc.line.netPrice,
      itemName: lc.line.itemName,
      vat: { categoryCode: regimeDecision.categoryCode, rate: lc.rate },
      // BT-158/BT-159 (T-060 continuation, D-19) — undefined passes through untouched, same as every
      // other optional field here; @normwerk/einvoice-cii's plan skips the whole DesignatedProductClassification
      // / OriginTradeCountry element when its source field is undefined (plan.ts's own `from` semantics).
      hsCode: lc.line.hsCode,
      originCountry: lc.line.originCountry,
    })),
  };

  const validation = validateModel(invoice);
  if (!validation.valid) {
    throw new InvalidAssembledInvoiceError(validation.errors);
  }

  return { invoice, decisions, warnings, vatIdEvidence: options.vatIdEvidence };
}
