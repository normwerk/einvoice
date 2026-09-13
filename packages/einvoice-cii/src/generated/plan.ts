/**
 * GENERATED-STYLE FILE — do not hand-edit casually (AGENTS.md §9).
 *
 * CII D16B serialization plan for `Invoice` (einvoice-model). Every element
 * path and sequence order below is checked against two vendored, EUPL-1.2
 * artifacts (artifacts/MANIFEST.json):
 *   - artifacts/cii-d16b/schema/*.xsd — element names and sequence order
 *     (`<xsd:sequence>` in `HeaderTradeAgreementType`, `TradePartyType`,
 *     `TradeTaxType`, etc. — a wrong order here is an L1 XSD failure, not a
 *     style nit)
 *   - artifacts/cii-d16b/schematron/EN16931-CII-validation-preprocessed.sch
 *     — the exact XPath each BR-* rule's `test`/`context` attribute uses
 *     (e.g. BR-09's test attribute is the literal source of the seller
 *     country code's path below)
 *
 * Unlike `einvoice-model`'s terms.mjs, this plan is authored directly
 * rather than mechanically cross-checked by a script — the nesting a
 * serialization plan needs (which element is a sibling of which, at what
 * depth) isn't a single quoted phrase the way a BT name is, so an
 * automatic check here would just be re-deriving the schema, not
 * verifying against it. Every path was looked up in the files above while
 * writing this, not recalled from memory. Where a genuine binding
 * limitation exists (not just an unmodeled field), it's called out
 * explicitly rather than silently worked around.
 *
 * COVERAGE: exactly the `Invoice` fields the 6 base fixtures
 * (fixtures/, T-050) use. Payment means/account (BG-16), item attributes
 * (BG-32), and additional supporting documents (BG-24) are modeled in
 * einvoice-model but not yet in this plan — none of the 6 fixtures need
 * them. Follow-up: T-020 continuation, extend as new fixtures need them.
 */
import type { PlanNode, QName } from "../plan-types.js";

const rsm = (local: string): QName => ({ prefix: "rsm", local });
const ram = (local: string): QName => ({ prefix: "ram", local });
const udt = (local: string): QName => ({ prefix: "udt", local });

/** BT-118/95/102/151: every VAT category code uses the same "VAT" type code — UNCL5153, not modeled per-field. */
const VAT_TYPE_CODE = "VAT";

/**
 * BG-30 Line VAT information — nested under the line's
 * SpecifiedLineTradeSettlement/ApplicableTradeTax (verified: BR-CL-18's
 * context, plus the TradeTaxType sequence: CalculatedAmount, TypeCode,
 * ..., CategoryCode, ..., RateApplicablePercent).
 */
const lineVatNode: PlanNode = {
  kind: "element",
  name: ram("ApplicableTradeTax"),
  children: [
    { kind: "value", name: ram("TypeCode"), literal: VAT_TYPE_CODE },
    { kind: "value", name: ram("CategoryCode"), from: "categoryCode", bt: "BT-151" },
    { kind: "value", name: ram("RateApplicablePercent"), from: "rate", format: "amount", bt: "BT-152" },
  ],
};

/**
 * BG-20/21 Document level allowance/charge — TradeAllowanceChargeType
 * sequence: ChargeIndicator, ..., BasisAmount, ..., ActualAmount, ...,
 * ReasonCode, Reason, ..., CategoryTradeTax.
 */
function allowanceChargeNode(isCharge: boolean): PlanNode {
  return {
    kind: "repeat",
    name: ram("SpecifiedTradeAllowanceCharge"),
    from: isCharge ? "documentLevelCharges" : "documentLevelAllowances",
    children: [
      {
        kind: "element",
        name: ram("ChargeIndicator"),
        children: [{ kind: "value", name: udt("Indicator"), literal: isCharge ? "true" : "false" }],
      },
      { kind: "value", name: ram("BasisAmount"), from: "baseAmount", format: "amount", bt: isCharge ? "BT-100" : "BT-93" },
      { kind: "value", name: ram("ActualAmount"), from: "amount", format: "amount", bt: isCharge ? "BT-99" : "BT-92" },
      { kind: "value", name: ram("ReasonCode"), from: "reasonCode", bt: isCharge ? "BT-105" : "BT-98" },
      { kind: "value", name: ram("Reason"), from: "reason", bt: isCharge ? "BT-104" : "BT-97" },
      {
        kind: "element",
        name: ram("CategoryTradeTax"),
        children: [
          { kind: "value", name: ram("TypeCode"), literal: VAT_TYPE_CODE },
          { kind: "value", name: ram("CategoryCode"), from: "vatCategoryCode", bt: isCharge ? "BT-102" : "BT-95" },
          { kind: "value", name: ram("RateApplicablePercent"), from: "vatRate", format: "amount", bt: isCharge ? "BT-103" : "BT-96" },
        ],
      },
    ],
  };
}

const invoiceLineNode: PlanNode = {
  kind: "repeat",
  name: ram("IncludedSupplyChainTradeLineItem"),
  from: "lines",
  children: [
    {
      kind: "element",
      name: ram("AssociatedDocumentLineDocument"),
      children: [{ kind: "value", name: ram("LineID"), from: "identifier", bt: "BT-126" }],
    },
    {
      kind: "element",
      name: ram("SpecifiedTradeProduct"),
      children: [{ kind: "value", name: ram("Name"), from: "itemName", bt: "BT-153" }],
    },
    {
      kind: "element",
      name: ram("SpecifiedLineTradeAgreement"),
      children: [
        {
          kind: "element",
          name: ram("NetPriceProductTradePrice"),
          children: [{ kind: "value", name: ram("ChargeAmount"), from: "netPrice", format: "amount", bt: "BT-146" }],
        },
      ],
    },
    {
      kind: "element",
      name: ram("SpecifiedLineTradeDelivery"),
      children: [
        {
          kind: "value",
          name: ram("BilledQuantity"),
          from: "quantity",
          format: "amount",
          attributes: [{ name: "unitCode", from: "unitCode" }],
          bt: "BT-129",
        },
      ],
    },
    {
      kind: "element",
      name: ram("SpecifiedLineTradeSettlement"),
      children: [
        { ...lineVatNode, from: "vat" } as PlanNode,
        {
          kind: "element",
          name: ram("SpecifiedTradeSettlementLineMonetarySummation"),
          children: [{ kind: "value", name: ram("LineTotalAmount"), from: "netAmount", format: "amount", bt: "BT-131" }],
        },
      ],
    },
  ],
};

export const invoicePlan: PlanNode = {
  kind: "element",
  name: rsm("CrossIndustryInvoice"),
  children: [
    {
      kind: "element",
      name: rsm("ExchangedDocumentContext"),
      children: [
        {
          kind: "element",
          name: ram("GuidelineSpecifiedDocumentContextParameter"),
          children: [{ kind: "value", name: ram("ID"), from: "specificationIdentifier", bt: "BT-24" }],
        },
      ],
    },
    {
      kind: "element",
      name: rsm("ExchangedDocument"),
      children: [
        { kind: "value", name: ram("ID"), from: "number", bt: "BT-1" },
        { kind: "value", name: ram("TypeCode"), from: "typeCode", bt: "BT-3" },
        {
          kind: "element",
          name: ram("IssueDateTime"),
          children: [
            {
              kind: "value",
              name: udt("DateTimeString"),
              from: "issueDate",
              format: "date-cii",
              attributes: [{ name: "format", literal: "102" }],
              bt: "BT-2",
            },
          ],
        },
      ],
    },
    {
      kind: "element",
      name: rsm("SupplyChainTradeTransaction"),
      children: [
        invoiceLineNode,
        {
          // BG-4/BG-7/BG-11 group, in HeaderTradeAgreementType's own
          // sequence order: BuyerReference, SellerTradeParty,
          // BuyerTradeParty, ..., SellerTaxRepresentativeTradeParty.
          kind: "element",
          name: ram("ApplicableHeaderTradeAgreement"),
          children: [
            { kind: "value", name: ram("BuyerReference"), from: "buyerReference", bt: "BT-10" },
            sellerPartyNode(),
            buyerPartyNode(),
            taxRepresentativeNode(),
          ],
        },
        {
          // BG-13 Delivery — element itself is mandatory (HeaderTradeDeliveryType
          // has no minOccurs on the SupplyChainTradeTransactionType side),
          // children are all optional.
          kind: "element",
          name: ram("ApplicableHeaderTradeDelivery"),
          children: [
            {
              kind: "element",
              name: ram("ShipToTradeParty"),
              from: "delivery.deliverToCountryCode",
              children: [
                {
                  kind: "element",
                  name: ram("PostalTradeAddress"),
                  children: [{ kind: "value", name: ram("CountryID"), from: "", bt: "BT-80" }],
                },
              ],
            },
            {
              kind: "element",
              name: ram("ActualDeliverySupplyChainEvent"),
              from: "delivery.actualDeliveryDate",
              children: [
                {
                  kind: "element",
                  name: ram("OccurrenceDateTime"),
                  children: [
                    {
                      kind: "value",
                      name: udt("DateTimeString"),
                      from: "",
                      format: "date-cii",
                      attributes: [{ name: "format", literal: "102" }],
                      bt: "BT-72",
                    },
                  ],
                },
              ],
            },
          ],
        },
        headerSettlementNode(),
      ],
    },
  ],
};

function sellerPartyNode(): PlanNode {
  return {
    kind: "element",
    name: ram("SellerTradeParty"),
    from: "seller",
    children: [
      { kind: "value", name: ram("ID"), from: "identifier", bt: "BT-29" },
      { kind: "value", name: ram("Name"), from: "name", bt: "BT-27" },
      {
        kind: "element",
        name: ram("SpecifiedLegalOrganization"),
        from: "legalRegistrationIdentifier",
        children: [{ kind: "value", name: ram("ID"), from: "", bt: "BT-30" }],
      },
      {
        kind: "element",
        name: ram("PostalTradeAddress"),
        children: [{ kind: "value", name: ram("CountryID"), from: "countryCode", bt: "BT-40" }],
      },
      {
        kind: "element",
        name: ram("SpecifiedTaxRegistration"),
        from: "vatIdentifier",
        children: [{ kind: "value", name: ram("ID"), from: "", attributes: [{ name: "schemeID", literal: "VA" }], bt: "BT-31" }],
      },
      {
        kind: "element",
        name: ram("SpecifiedTaxRegistration"),
        from: "taxRegistrationIdentifier",
        children: [{ kind: "value", name: ram("ID"), from: "", attributes: [{ name: "schemeID", literal: "FC" }], bt: "BT-32" }],
      },
    ],
  };
}

function buyerPartyNode(): PlanNode {
  return {
    kind: "element",
    name: ram("BuyerTradeParty"),
    from: "buyer",
    children: [
      { kind: "value", name: ram("Name"), from: "name", bt: "BT-44" },
      {
        kind: "element",
        name: ram("SpecifiedLegalOrganization"),
        from: "legalRegistrationIdentifier",
        children: [{ kind: "value", name: ram("ID"), from: "", bt: "BT-47" }],
      },
      {
        kind: "element",
        name: ram("PostalTradeAddress"),
        children: [{ kind: "value", name: ram("CountryID"), from: "countryCode", bt: "BT-55" }],
      },
      {
        kind: "element",
        name: ram("SpecifiedTaxRegistration"),
        from: "vatIdentifier",
        children: [{ kind: "value", name: ram("ID"), from: "", attributes: [{ name: "schemeID", literal: "VA" }], bt: "BT-48" }],
      },
    ],
  };
}

function taxRepresentativeNode(): PlanNode {
  return {
    kind: "element",
    name: ram("SellerTaxRepresentativeTradeParty"),
    from: "sellerTaxRepresentative",
    children: [
      {
        kind: "element",
        name: ram("PostalTradeAddress"),
        children: [{ kind: "value", name: ram("CountryID"), from: "countryCode", bt: "BT-69" }],
      },
      {
        kind: "element",
        name: ram("SpecifiedTaxRegistration"),
        from: "vatIdentifier",
        children: [{ kind: "value", name: ram("ID"), from: "", attributes: [{ name: "schemeID", literal: "VA" }], bt: "BT-63" }],
      },
    ],
  };
}

function headerSettlementNode(): PlanNode {
  return {
    // ApplicableHeaderTradeSettlement is itself mandatory; sequence order
    // per HeaderTradeSettlementType: ..., InvoiceCurrencyCode, ...,
    // SpecifiedTradeSettlementPaymentMeans, ApplicableTradeTax,
    // BillingSpecifiedPeriod, SpecifiedTradeAllowanceCharge, ...,
    // SpecifiedTradeSettlementHeaderMonetarySummation, ...,
    // InvoiceReferencedDocument.
    kind: "element",
    name: ram("ApplicableHeaderTradeSettlement"),
    children: [
      { kind: "value", name: ram("InvoiceCurrencyCode"), from: "currencyCode", bt: "BT-5" },
      {
        kind: "repeat",
        name: ram("ApplicableTradeTax"),
        from: "vatBreakdown",
        children: [
          { kind: "value", name: ram("CalculatedAmount"), from: "taxAmount", format: "amount", bt: "BT-117" },
          { kind: "value", name: ram("TypeCode"), literal: VAT_TYPE_CODE },
          { kind: "value", name: ram("ExemptionReason"), from: "exemptionReasonText", bt: "BT-120" },
          { kind: "value", name: ram("BasisAmount"), from: "taxableAmount", format: "amount", bt: "BT-116" },
          { kind: "value", name: ram("CategoryCode"), from: "categoryCode", bt: "BT-118" },
          { kind: "value", name: ram("ExemptionReasonCode"), from: "exemptionReasonCode", bt: "BT-121" },
          { kind: "value", name: ram("RateApplicablePercent"), from: "rate", format: "amount", bt: "BT-119" },
        ],
      },
      {
        kind: "element",
        name: ram("BillingSpecifiedPeriod"),
        from: "invoicingPeriod",
        children: [
          {
            kind: "element",
            name: ram("StartDateTime"),
            from: "startDate",
            children: [
              { kind: "value", name: udt("DateTimeString"), from: "", format: "date-cii", attributes: [{ name: "format", literal: "102" }], bt: "BT-73" },
            ],
          },
          {
            kind: "element",
            name: ram("EndDateTime"),
            from: "endDate",
            children: [
              { kind: "value", name: udt("DateTimeString"), from: "", format: "date-cii", attributes: [{ name: "format", literal: "102" }], bt: "BT-74" },
            ],
          },
        ],
      },
      allowanceChargeNode(false),
      allowanceChargeNode(true),
      {
        kind: "element",
        name: ram("SpecifiedTradeSettlementHeaderMonetarySummation"),
        children: [
          // CII-DT-031 (XRechnung-CII-validation.xsl, KoSIT/Apache-2.0):
          // "currencyID should not be present" on any `ram:*Amount`
          // element EXCEPT `ram:TaxTotalAmount` — confirmed against the
          // real validator, not assumed. Found by running these fixtures
          // through our own Docker KoSIT validator (spike C tooling) and
          // reading the rejection.
          { kind: "value", name: ram("LineTotalAmount"), from: "totals.sumOfLineNetAmounts", format: "amount", bt: "BT-106" },
          { kind: "value", name: ram("ChargeTotalAmount"), from: "totals.sumOfCharges", format: "amount", bt: "BT-108" },
          { kind: "value", name: ram("AllowanceTotalAmount"), from: "totals.sumOfAllowances", format: "amount", bt: "BT-107" },
          { kind: "value", name: ram("TaxBasisTotalAmount"), from: "totals.totalAmountWithoutVat", format: "amount", bt: "BT-109" },
          { kind: "value", name: ram("TaxTotalAmount"), from: "totals.totalVatAmount", format: "amount", attributes: [currencyAttr()], bt: "BT-110" },
          { kind: "value", name: ram("RoundingAmount"), from: "totals.roundingAmount", format: "amount", bt: "BT-114" },
          { kind: "value", name: ram("GrandTotalAmount"), from: "totals.totalAmountWithVat", format: "amount", bt: "BT-112" },
          { kind: "value", name: ram("TotalPrepaidAmount"), from: "totals.paidAmount", format: "amount", bt: "BT-113" },
          { kind: "value", name: ram("DuePayableAmount"), from: "totals.amountDueForPayment", format: "amount", bt: "BT-115" },
        ],
      },
      {
        // BG-3: EN 16931 lets this repeat ("Each Preceding Invoice
        // reference"), but CII D16B's InvoiceReferencedDocument has no
        // maxOccurs="unbounded" in HeaderTradeSettlementType — it caps at
        // one. A genuine binding limitation, not an oversight: only the
        // first `precedingInvoiceReferences` entry is serialized.
        kind: "repeat",
        name: ram("InvoiceReferencedDocument"),
        from: "precedingInvoiceReferences",
        firstOnly: true,
        children: [{ kind: "value", name: ram("IssuerAssignedID"), from: "invoiceNumber", bt: "BT-25" }],
      },
    ],
  };
}

function currencyAttr() {
  return { name: "currencyID", from: "currencyCode" } as const;
}
