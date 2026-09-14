/**
 * T-041: maps a `@normwerk/einvoice-model` Invoice into the UBL-JSON shape
 * that `@e-invoice-eu/core`'s `InvoiceService.generate()` expects as input.
 *
 * `@e-invoice-eu/core` (WTFPL, npm name verified — NOT the bare `e-invoice-eu`,
 * which does not exist) takes a JSON object shaped after the UBL 2.1 XML
 * syntax itself (`ubl:Invoice` root, `cac:`/`cbc:` keys mirroring UBL element
 * names, `@attrName` suffixes for XML attributes) and can render it as CII,
 * UBL, or other formats. It is used here purely as an independent, real,
 * third-party generator for the L4 differential oracle (AGENTS.md §8 rule 2)
 * — never imported by any published package (M-005/D-17).
 *
 * The exact shape below was read directly from the library's own .d.ts files
 * (node_modules/@e-invoice-eu/core/dist/invoice/invoice.interface.d.ts and
 * invoice.service.d.ts) — not from its README, per this session's standing
 * rule to verify exact technical claims against real source, never a
 * WebFetch summary (see memory: verify-urls-before-committing).
 */

function amountAttrs(node, key, value, currencyCode) {
  if (value === undefined) return;
  node[key] = value;
  node[`${key}@currencyID`] = currencyCode;
}

function mapParty(party, { isSeller }) {
  const node = {
    "cac:PostalAddress": {
      "cbc:CityName": party.city,
      "cbc:PostalZone": party.postCode,
      "cac:Country": { "cbc:IdentificationCode": party.countryCode },
    },
    "cac:PartyLegalEntity": {
      "cbc:RegistrationName": party.name,
      ...(party.legalRegistrationIdentifier
        ? { "cbc:CompanyID": party.legalRegistrationIdentifier }
        : {}),
    },
  };
  if (party.electronicAddress) {
    node["cbc:EndpointID"] = party.electronicAddress;
    if (party.electronicAddressScheme)
      node["cbc:EndpointID@schemeID"] = party.electronicAddressScheme;
  }
  if (party.vatIdentifier) {
    const taxScheme = {
      "cbc:CompanyID": party.vatIdentifier,
      "cac:TaxScheme": { "cbc:ID": "VAT" },
    };
    // SELLER.PartyTaxScheme is an array (0-2 entries); BUYER.PartyTaxScheme is a bare object —
    // both confirmed from the .d.ts, not assumed by symmetry.
    node["cac:PartyTaxScheme"] = isSeller ? [taxScheme] : taxScheme;
  }
  if (isSeller && party.contact) {
    node["cac:Contact"] = {
      "cbc:Name": party.contact.name,
      "cbc:Telephone": party.contact.telephone,
      "cbc:ElectronicMail": party.contact.email,
    };
  }
  return node;
}

function mapDocumentAllowanceCharge(item, chargeIndicator, currencyCode) {
  const node = {
    "cbc:ChargeIndicator": String(chargeIndicator),
    "cac:TaxCategory": {
      "cbc:ID": item.vatCategoryCode,
      ...(item.vatRate !== undefined ? { "cbc:Percent": item.vatRate } : {}),
      "cac:TaxScheme": { "cbc:ID": "VAT" },
    },
  };
  amountAttrs(node, "cbc:Amount", item.amount, currencyCode);
  if (item.baseAmount !== undefined)
    amountAttrs(node, "cbc:BaseAmount", item.baseAmount, currencyCode);
  // T-027: UBL's percent field for an allowance/charge is
  // MultiplierFactorNumeric — NOT cbc:Percent, which above is TaxCategory's
  // VAT rate (BT-96/103), a different field with the same English name.
  // Confirmed from the .d.ts, not assumed by analogy.
  if (item.calculationPercent !== undefined)
    node["cbc:MultiplierFactorNumeric"] = item.calculationPercent;
  if (item.reasonCode) node["cbc:AllowanceChargeReasonCode"] = item.reasonCode;
  if (item.reason) node["cbc:AllowanceChargeReason"] = item.reason;
  return node;
}

function mapLineAllowanceCharge(item, chargeIndicator, currencyCode) {
  const node = { "cbc:ChargeIndicator": String(chargeIndicator) };
  amountAttrs(node, "cbc:Amount", item.amount, currencyCode);
  if (item.baseAmount !== undefined)
    amountAttrs(node, "cbc:BaseAmount", item.baseAmount, currencyCode);
  if (item.calculationPercent !== undefined)
    node["cbc:MultiplierFactorNumeric"] = item.calculationPercent;
  if (item.reasonCode) node["cbc:AllowanceChargeReasonCode"] = item.reasonCode;
  if (item.reason) node["cbc:AllowanceChargeReason"] = item.reason;
  return node;
}

function mapTaxRepresentative(rep) {
  // SELLERTAXREPRESENTATIVEPARTY: PartyName (BT-62) and PostalAddress.Country
  // (BT-69) are required, PartyTaxScheme.CompanyID (BT-63) too — our model
  // has exactly these three fields and nothing else for this party (T-093).
  return {
    "cac:PartyName": { "cbc:Name": rep.name },
    "cac:PostalAddress": { "cac:Country": { "cbc:IdentificationCode": rep.countryCode } },
    "cac:PartyTaxScheme": {
      "cbc:CompanyID": rep.vatIdentifier,
      "cac:TaxScheme": { "cbc:ID": "VAT" },
    },
  };
}

function mapLine(line, currencyCode) {
  const item = {
    "cbc:Name": line.itemName,
    "cac:ClassifiedTaxCategory": {
      "cbc:ID": line.vat.categoryCode,
      ...(line.vat.rate !== undefined ? { "cbc:Percent": line.vat.rate } : {}),
      "cac:TaxScheme": { "cbc:ID": "VAT" },
    },
  };
  if (line.itemAttributes?.length) {
    item["cac:AdditionalItemProperty"] = line.itemAttributes.map((a) => ({
      "cbc:Name": a.name,
      "cbc:Value": a.value,
    }));
  }

  const price = {};
  amountAttrs(price, "cbc:PriceAmount", line.netPrice, currencyCode);

  const node = {
    "cbc:ID": line.identifier,
    "cbc:InvoicedQuantity": line.quantity,
    "cbc:InvoicedQuantity@unitCode": line.unitCode,
    "cac:Item": item,
    "cac:Price": price,
  };
  amountAttrs(node, "cbc:LineExtensionAmount", line.netAmount, currencyCode);

  const allowanceCharges = [
    ...(line.allowances ?? []).map((a) => mapLineAllowanceCharge(a, false, currencyCode)),
    ...(line.charges ?? []).map((c) => mapLineAllowanceCharge(c, true, currencyCode)),
  ];
  if (allowanceCharges.length) node["cac:AllowanceCharge"] = allowanceCharges;

  if (line.invoicingPeriod) {
    node["cac:InvoicePeriod"] = {
      ...(line.invoicingPeriod.startDate
        ? { "cbc:StartDate": line.invoicingPeriod.startDate }
        : {}),
      ...(line.invoicingPeriod.endDate ? { "cbc:EndDate": line.invoicingPeriod.endDate } : {}),
    };
  }
  return node;
}

/**
 * @param {import("../../../packages/einvoice-model/src/index.js").Invoice} invoice
 * @returns {object} `@e-invoice-eu/core`'s `Invoice` UBL-JSON input shape.
 */
export function mapInvoiceToUbl(invoice) {
  const cur = invoice.currencyCode;

  const taxSubtotals = invoice.vatBreakdown.map((row) => {
    const sub = {
      "cac:TaxCategory": {
        "cbc:ID": row.categoryCode,
        ...(row.rate !== undefined ? { "cbc:Percent": row.rate } : {}),
        ...(row.exemptionReasonCode
          ? { "cbc:TaxExemptionReasonCode": row.exemptionReasonCode }
          : {}),
        ...(row.exemptionReasonText ? { "cbc:TaxExemptionReason": row.exemptionReasonText } : {}),
        "cac:TaxScheme": { "cbc:ID": "VAT" },
      },
    };
    amountAttrs(sub, "cbc:TaxableAmount", row.taxableAmount, cur);
    amountAttrs(sub, "cbc:TaxAmount", row.taxAmount, cur);
    return sub;
  });

  const taxTotal = { "cac:TaxSubtotal": taxSubtotals };
  // BT-110 is optional in our model (a small number of exempt/zero-VAT
  // scenarios could theoretically omit it) but UBL's TAXTOTAL.TaxAmount is
  // required; all 13 real fixtures set it, so this fallback is untested by
  // them and documented rather than silently relied on.
  amountAttrs(taxTotal, "cbc:TaxAmount", invoice.totals.totalVatAmount ?? "0.00", cur);

  const totals = {};
  amountAttrs(totals, "cbc:LineExtensionAmount", invoice.totals.sumOfLineNetAmounts, cur);
  amountAttrs(totals, "cbc:TaxExclusiveAmount", invoice.totals.totalAmountWithoutVat, cur);
  amountAttrs(totals, "cbc:TaxInclusiveAmount", invoice.totals.totalAmountWithVat, cur);
  if (invoice.totals.sumOfAllowances !== undefined)
    amountAttrs(totals, "cbc:AllowanceTotalAmount", invoice.totals.sumOfAllowances, cur);
  if (invoice.totals.sumOfCharges !== undefined)
    amountAttrs(totals, "cbc:ChargeTotalAmount", invoice.totals.sumOfCharges, cur);
  if (invoice.totals.paidAmount !== undefined)
    amountAttrs(totals, "cbc:PrepaidAmount", invoice.totals.paidAmount, cur);
  if (invoice.totals.roundingAmount !== undefined)
    amountAttrs(totals, "cbc:PayableRoundingAmount", invoice.totals.roundingAmount, cur);
  amountAttrs(totals, "cbc:PayableAmount", invoice.totals.amountDueForPayment, cur);

  const ublInvoice = {
    "cbc:CustomizationID": invoice.specificationIdentifier,
    "cbc:ID": invoice.number,
    "cbc:IssueDate": invoice.issueDate,
    "cbc:InvoiceTypeCode": invoice.typeCode,
    "cbc:DocumentCurrencyCode": cur,
    "cac:AccountingSupplierParty": { "cac:Party": mapParty(invoice.seller, { isSeller: true }) },
    "cac:AccountingCustomerParty": { "cac:Party": mapParty(invoice.buyer, { isSeller: false }) },
    "cac:TaxTotal": [taxTotal],
    "cac:LegalMonetaryTotal": totals,
    "cac:InvoiceLine": invoice.lines.map((line) => mapLine(line, cur)),
  };

  if (invoice.businessProcessType) ublInvoice["cbc:ProfileID"] = invoice.businessProcessType;
  if (invoice.buyerReference) ublInvoice["cbc:BuyerReference"] = invoice.buyerReference;
  if (invoice.taxCurrencyCode) ublInvoice["cbc:TaxCurrencyCode"] = invoice.taxCurrencyCode;
  if (invoice.taxPointDate) ublInvoice["cbc:TaxPointDate"] = invoice.taxPointDate;
  if (invoice.sellerTaxRepresentative) {
    ublInvoice["cac:TaxRepresentativeParty"] = mapTaxRepresentative(
      invoice.sellerTaxRepresentative,
    );
  }

  if (invoice.invoicingPeriod) {
    ublInvoice["cac:InvoicePeriod"] = {
      ...(invoice.invoicingPeriod.startDate
        ? { "cbc:StartDate": invoice.invoicingPeriod.startDate }
        : {}),
      ...(invoice.invoicingPeriod.endDate
        ? { "cbc:EndDate": invoice.invoicingPeriod.endDate }
        : {}),
    };
  }

  if (invoice.precedingInvoiceReferences?.length) {
    ublInvoice["cac:BillingReference"] = invoice.precedingInvoiceReferences.map((r) => ({
      "cac:InvoiceDocumentReference": {
        "cbc:ID": r.invoiceNumber,
        ...(r.issueDate ? { "cbc:IssueDate": r.issueDate } : {}),
      },
    }));
  }

  if (invoice.additionalSupportingDocuments?.length) {
    ublInvoice["cac:AdditionalDocumentReference"] = invoice.additionalSupportingDocuments.map(
      (d) => ({
        "cbc:ID": d.reference,
      }),
    );
  }

  if (invoice.delivery) {
    const d = invoice.delivery;
    const address = {};
    if (d.deliverToCity) address["cbc:CityName"] = d.deliverToCity;
    if (d.deliverToPostCode) address["cbc:PostalZone"] = d.deliverToPostCode;
    if (d.deliverToCountryCode)
      address["cac:Country"] = { "cbc:IdentificationCode": d.deliverToCountryCode };
    const delivery = {};
    if (d.actualDeliveryDate) delivery["cbc:ActualDeliveryDate"] = d.actualDeliveryDate;
    if (Object.keys(address).length) delivery["cac:DeliveryLocation"] = { "cac:Address": address };
    if (Object.keys(delivery).length) ublInvoice["cac:Delivery"] = delivery;
  }

  if (invoice.paymentInstructions) {
    const pi = invoice.paymentInstructions;
    const node = {};
    // PaymentMeansCode is required by UBL's PAYMENTINSTRUCTIONS type; our
    // model allows it to be absent. All 13 fixtures that set
    // paymentInstructions also set meansTypeCode (XRechnung requires it via
    // BR-DE-17), so this gap is documented, not silently patched.
    if (pi.meansTypeCode) node["cbc:PaymentMeansCode"] = pi.meansTypeCode;
    if (pi.accountIdentifier)
      node["cac:PayeeFinancialAccount"] = { "cbc:ID": pi.accountIdentifier };
    ublInvoice["cac:PaymentMeans"] = [node];
  }

  const documentAllowanceCharges = [
    ...(invoice.documentLevelAllowances ?? []).map((a) =>
      mapDocumentAllowanceCharge(a, false, cur),
    ),
    ...(invoice.documentLevelCharges ?? []).map((c) => mapDocumentAllowanceCharge(c, true, cur)),
  ];
  if (documentAllowanceCharges.length) ublInvoice["cac:AllowanceCharge"] = documentAllowanceCharges;

  return { "ubl:Invoice": ublInvoice };
}
