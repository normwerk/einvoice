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
import { DE_STANDARD_RATE, decideVatCategory, resolveLineRate } from "./tax-rules.js";
import { multiplyToAmount, percentOfAmount, subtractAmounts, sumAmounts } from "./decimal.js";
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
  readonly reason?: string;
}

export function buildInvoice(
  input: CommerceInvoiceInput,
  options: BuildInvoiceOptions = {},
): BuildResult {
  if (input.schemaVersion !== 1) {
    throw new UnsupportedSchemaVersionError(input.schemaVersion);
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
    warnings.push({
      code: "customs-not-mapped",
      message:
        "input.customs (BT-158/159 and related) has no equivalent field in the current Invoice model yet (D-19 — a dedicated model-codegen task) — dropped.",
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
    })),
  };

  const validation = validateModel(invoice);
  if (!validation.valid) {
    throw new InvalidAssembledInvoiceError(validation.errors);
  }

  return { invoice, decisions, warnings, vatIdEvidence: options.vatIdEvidence };
}
