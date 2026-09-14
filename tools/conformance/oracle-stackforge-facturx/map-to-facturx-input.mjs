/**
 * T-042: maps a `@normwerk/einvoice-model` Invoice into the `FacturXInvoiceInput`
 * shape that `@stackforge-eu/factur-x`'s `toXRechnung()`/`buildXml()` expect.
 *
 * `@stackforge-eu/factur-x` (EUPL-1.2, devDependency only — never imported by
 * any published package, M-005/D-17) has a flat, hand-modeled input object
 * (amounts as JS `number`, not decimal strings) rather than a UBL-shaped one
 * like `@e-invoice-eu/core` — read directly from its own
 * `node_modules/@stackforge-eu/factur-x/dist/index.d.ts`, not its README
 * (see memory: verify-urls-before-committing).
 */

function num(value) {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (Number.isNaN(n))
    throw new Error(`map-to-facturx-input: not a number: ${JSON.stringify(value)}`);
  return n;
}

function mapAddress(party) {
  // BT-35/50 (street address) has no field in einvoice-model at all — same
  // class of gap as T-041's BT-62 finding. AddressInput.line1 is typed as
  // mandatory in the library's .d.ts, but this is plain JS at runtime; an
  // empty string is the honest "we don't have this" value, not a fabricated
  // street. Documented here rather than silently invented.
  return {
    line1: "",
    city: party.city,
    postalCode: party.postCode,
    country: party.countryCode,
  };
}

function mapParty(party) {
  const out = { name: party.name, address: mapAddress(party) };
  if (party.identifier) out.id = party.identifier; // BT-29, seller only in our model
  if (party.electronicAddress) {
    out.electronicAddress = {
      value: party.electronicAddress,
      schemeID: party.electronicAddressScheme,
    };
  }
  const taxRegistrations = [];
  if (party.vatIdentifier) taxRegistrations.push({ id: party.vatIdentifier, schemeId: "VA" });
  if (party.taxRegistrationIdentifier)
    taxRegistrations.push({ id: party.taxRegistrationIdentifier, schemeId: "FC" });
  if (taxRegistrations.length) out.taxRegistrations = taxRegistrations;
  if (party.legalRegistrationIdentifier)
    out.legalOrganization = { id: party.legalRegistrationIdentifier };
  if (party.contact) {
    out.contact = {
      name: party.contact.name,
      phone: party.contact.telephone,
      email: party.contact.email,
    };
  }
  return out;
}

function mapTaxRepresentative(rep) {
  // TradePartyInput.address is optional in the .d.ts, but leaving it out
  // entirely means BT-69 (country) never renders, which fails BR-20 on a
  // real KoSIT run — and the address builder crashes (TypeError) if any of
  // line1/city/postalCode is `undefined` rather than a string (confirmed
  // empirically, same root cause as the LineOne bug in D-22/T-042: it
  // never checks for undefined before calling .replace()). Our model has
  // no city/postCode/street for the tax representative at all (only
  // country, T-093), so all three become "" — which reproduces the exact
  // same already-classified empty-element finding (D-22 #1), not a new one.
  return {
    name: rep.name,
    address: { line1: "", city: "", postalCode: "", country: rep.countryCode },
    taxRegistrations: [{ id: rep.vatIdentifier, schemeId: "VA" }],
  };
}

function mapLine(line) {
  if (line.allowances?.length || line.charges?.length) {
    // BG-27/28 (line-level allowance/charge, BT-136/141 — a settlement-level
    // deduction/addition on the line) has no equivalent field on
    // InvoiceLineInput. The library only models BT-147/148
    // (priceDiscount/grossUnitPrice), a *different* XSD binding
    // (GrossPriceProductTradePrice/AppliedTradeAllowanceCharge, inside the
    // price element, not SpecifiedLineTradeSettlement/
    // SpecifiedTradeAllowanceCharge) with different EN 16931 business
    // meaning (a price-list discount, not a settlement allowance) — even
    // though the arithmetic could be squeezed to match. Refusing rather
    // than silently remapping to a different business term, same
    // discipline as the sellerTaxRepresentative refusal in map-to-ubl.mjs.
    throw new Error(
      "mapToFacturXInput: line-level allowances/charges (BG-27/28) have no equivalent " +
        "in @stackforge-eu/factur-x's InvoiceLineInput (only BT-147/148 price-list " +
        "discount, a different binding) — refusing rather than remapping to a different term",
    );
  }
  if (line.invoicingPeriod || line.itemAttributes?.length) {
    throw new Error(
      "mapToFacturXInput: invoice line period (BG-26) and item attributes (BG-32) have " +
        "no equivalent field on InvoiceLineInput",
    );
  }
  return {
    id: line.identifier,
    name: line.itemName,
    quantity: num(line.quantity),
    unitCode: line.unitCode,
    unitPrice: num(line.netPrice),
    lineTotal: num(line.netAmount),
    vatCategoryCode: line.vat.categoryCode,
    vatRatePercent: num(line.vat.rate),
  };
}

/**
 * @param {import("../../../packages/einvoice-model/src/index.js").Invoice} invoice
 * @returns {object} `@stackforge-eu/factur-x`'s `FacturXInvoiceInput` shape.
 */
export function mapInvoiceToFacturXInput(invoice) {
  if (invoice.additionalSupportingDocuments?.length) {
    throw new Error(
      "mapToFacturXInput: additionalSupportingDocuments (BG-24) has no equivalent field",
    );
  }

  const totals = {
    lineTotal: num(invoice.totals.sumOfLineNetAmounts),
    taxBasisTotal: num(invoice.totals.totalAmountWithoutVat),
    // BT-110 required by InvoiceTotalsInput; all 13 real fixtures set it.
    taxTotal: num(invoice.totals.totalVatAmount ?? "0"),
    grandTotal: num(invoice.totals.totalAmountWithVat),
    duePayableAmount: num(invoice.totals.amountDueForPayment),
    currency: invoice.currencyCode,
  };
  if (invoice.totals.sumOfAllowances !== undefined)
    totals.allowanceTotal = num(invoice.totals.sumOfAllowances);
  if (invoice.totals.sumOfCharges !== undefined)
    totals.chargeTotal = num(invoice.totals.sumOfCharges);
  if (invoice.totals.paidAmount !== undefined)
    totals.prepaidAmount = num(invoice.totals.paidAmount);
  if (invoice.taxCurrencyCode) totals.taxCurrency = invoice.taxCurrencyCode;

  const input = {
    document: {
      id: invoice.number,
      issueDate: invoice.issueDate,
      typeCode: invoice.typeCode,
    },
    seller: mapParty(invoice.seller),
    buyer: mapParty(invoice.buyer),
    lines: invoice.lines.map(mapLine),
    totals,
    vatBreakdown: invoice.vatBreakdown.map((row) => ({
      categoryCode: row.categoryCode,
      // BT-119 optional in our model, required here; all 13 fixtures set it
      // explicitly (including exempt/reverse-charge rows, always "0").
      ratePercent: num(row.rate ?? "0"),
      taxableAmount: num(row.taxableAmount),
      taxAmount: num(row.taxAmount),
      ...(row.exemptionReasonText ? { exemptionReason: row.exemptionReasonText } : {}),
      ...(row.exemptionReasonCode ? { exemptionReasonCode: row.exemptionReasonCode } : {}),
    })),
  };

  if (invoice.buyerReference) input.document.buyerReference = invoice.buyerReference;
  if (invoice.businessProcessType) input.document.businessProcessId = invoice.businessProcessType;
  if (invoice.sellerTaxRepresentative) {
    input.sellerTaxRepresentative = mapTaxRepresentative(invoice.sellerTaxRepresentative);
  }

  if (invoice.precedingInvoiceReferences?.length) {
    input.references = invoice.precedingInvoiceReferences.map((r) => ({
      id: r.invoiceNumber,
      type: "preceding",
      ...(r.issueDate ? { issueDate: r.issueDate } : {}),
    }));
  }

  if (invoice.delivery) {
    const d = invoice.delivery;
    const delivery = {};
    if (d.actualDeliveryDate) delivery.date = d.actualDeliveryDate;
    if (d.deliverToCity || d.deliverToPostCode || d.deliverToCountryCode) {
      delivery.location = {
        line1: "", // same documented gap as mapAddress()
        city: d.deliverToCity,
        postalCode: d.deliverToPostCode,
        country: d.deliverToCountryCode,
      };
    }
    if (Object.keys(delivery).length) input.delivery = delivery;
  }

  if (invoice.paymentInstructions) {
    const pi = invoice.paymentInstructions;
    const payment = {};
    if (pi.meansTypeCode) payment.meansCode = pi.meansTypeCode;
    // Our model's accountIdentifier is a single generic field, but our own
    // CII serializer always binds it to IBANID (see plan.ts) — map to
    // `iban`, not the generic `accountId`, so both generators target the
    // same XML element for a like-for-like diff.
    if (pi.accountIdentifier) payment.iban = pi.accountIdentifier;
    if (Object.keys(payment).length) input.payment = payment;
  }

  const allowancesCharges = [
    ...(invoice.documentLevelAllowances ?? []).map((a) => ({
      isCharge: false,
      amount: num(a.amount),
      vatCategoryCode: a.vatCategoryCode,
      ...(a.vatRate !== undefined ? { vatRatePercent: num(a.vatRate) } : {}),
      ...(a.baseAmount !== undefined ? { baseAmount: num(a.baseAmount) } : {}),
      ...(a.reasonCode ? { reasonCode: a.reasonCode } : {}),
      ...(a.reason ? { reason: a.reason } : {}),
    })),
    ...(invoice.documentLevelCharges ?? []).map((c) => ({
      isCharge: true,
      amount: num(c.amount),
      vatCategoryCode: c.vatCategoryCode,
      ...(c.vatRate !== undefined ? { vatRatePercent: num(c.vatRate) } : {}),
      ...(c.baseAmount !== undefined ? { baseAmount: num(c.baseAmount) } : {}),
      ...(c.reasonCode ? { reasonCode: c.reasonCode } : {}),
      ...(c.reason ? { reason: c.reason } : {}),
    })),
  ];
  if (allowancesCharges.length) input.allowancesCharges = allowancesCharges;

  return input;
}
