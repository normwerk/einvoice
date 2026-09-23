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
 * (fixtures/, T-050) use, now including the XRechnung-profile fields
 * added in T-021 (business process, seller contact, seller/buyer
 * electronic address, city/postcode), plus BT-158/BT-159 (item
 * classification identifier / country of origin, T-060 continuation,
 * D-19) added for the commerce `customs` scenario. Item attributes
 * (BG-32) and additional supporting documents (BG-24) are modeled in
 * einvoice-model but not yet in this plan — no fixture needs them yet.
 * Follow-up: extend as new fixtures need them.
 */
import type { PlanNode, QName } from "../plan-types.js";

const rsm = (local: string): QName => ({ prefix: "rsm", local });
const ram = (local: string): QName => ({ prefix: "ram", local });
const udt = (local: string): QName => ({ prefix: "udt", local });
const qdt = (local: string): QName => ({ prefix: "qdt", local });

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
 * sequence: ChargeIndicator, ..., CalculationPercent, BasisAmount, ...,
 * ActualAmount, ..., ReasonCode, Reason, ..., CategoryTradeTax.
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
      {
        // T-027 / PEPPOL-EN16931-R042 (not in the base EN16931 schematron —
        // a KoSIT/XRechnung profile rule, see terms.mjs's comment on
        // BT-94): "Allowance/charge percentage MUST be provided when
        // allowance/charge base amount is provided." We don't enforce that
        // conditional in the type system (same as other conditional BRs
        // already in this plan) — just bind the field where the XSD puts it.
        kind: "value",
        name: ram("CalculationPercent"),
        from: "calculationPercent",
        format: "amount",
        bt: isCharge ? "BT-101" : "BT-94",
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

/**
 * BG-27/BG-28 Invoice line allowance/charge — same `TradeAllowanceChargeType`
 * shape as the document-level version (`allowanceChargeNode`), but without
 * `CategoryTradeTax`: `InvoiceLineAllowance`/`InvoiceLineCharge` (einvoice-model)
 * carry no VAT category of their own — the line's own BG-30 already covers
 * that, unlike a document-level allowance/charge which needs to state which
 * VAT category its amount reduces/adds to.
 */
function lineAllowanceChargeNode(isCharge: boolean): PlanNode {
  return {
    kind: "repeat",
    name: ram("SpecifiedTradeAllowanceCharge"),
    from: isCharge ? "charges" : "allowances",
    children: [
      {
        kind: "element",
        name: ram("ChargeIndicator"),
        children: [{ kind: "value", name: udt("Indicator"), literal: isCharge ? "true" : "false" }],
      },
      {
        // T-027 / PEPPOL-EN16931-R042 — same rule and same XSD position as
        // the document-level version above.
        kind: "value",
        name: ram("CalculationPercent"),
        from: "calculationPercent",
        format: "amount",
        bt: isCharge ? "BT-143" : "BT-138",
      },
      { kind: "value", name: ram("BasisAmount"), from: "baseAmount", format: "amount", bt: isCharge ? "BT-142" : "BT-137" },
      { kind: "value", name: ram("ActualAmount"), from: "amount", format: "amount", bt: isCharge ? "BT-141" : "BT-136" },
      { kind: "value", name: ram("ReasonCode"), from: "reasonCode", bt: isCharge ? "BT-145" : "BT-140" },
      { kind: "value", name: ram("Reason"), from: "reason", bt: isCharge ? "BT-144" : "BT-139" },
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
      // TradeProductType sequence (artifacts/cii-d16b/schema/..._ReusableAggregateBusinessInformationEntity_100pD16B.xsd):
      // Name, ..., DesignatedProductClassification, ..., OriginTradeCountry, ... — Name is BT-153, the
      // other two are BT-158/BT-159 (T-060 continuation, D-19).
      kind: "element",
      name: ram("SpecifiedTradeProduct"),
      children: [
        { kind: "value", name: ram("Name"), from: "itemName", bt: "BT-153" },
        {
          kind: "element",
          name: ram("DesignatedProductClassification"),
          from: "hsCode",
          children: [
            {
              kind: "value",
              name: ram("ClassCode"),
              from: "",
              // Scheme identifier is a fixed "HS" (Harmonized System) — the only scheme this repo's v0.1
              // scope supports (D-19), not a caller-supplied field. "HS" confirmed a member of UNTDID 7143
              // (BR-CL-13's own codelist, artifacts/cii-d16b/schematron/EN16931-CII-codes.sch) and — cross-
              // checked independently — the exact code docs.peppol.eu itself recommends for this purpose.
              attributes: [{ name: "listID", literal: "HS" }],
              bt: "BT-158",
            },
          ],
        },
        {
          kind: "element",
          name: ram("OriginTradeCountry"),
          from: "originCountry",
          children: [{ kind: "value", name: ram("ID"), from: "", bt: "BT-159" }],
        },
      ],
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
      // LineTradeSettlementType sequence: ..., ApplicableTradeTax, ...,
      // SpecifiedTradeAllowanceCharge, ..., SpecifiedTradeSettlementLineMonetarySummation.
      kind: "element",
      name: ram("SpecifiedLineTradeSettlement"),
      children: [
        { ...lineVatNode, from: "vat" } as PlanNode,
        lineAllowanceChargeNode(false),
        lineAllowanceChargeNode(true),
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
      // ExchangedDocumentContextType sequence: ..., BusinessProcess..., ...,
      // GuidelineSpecifiedDocumentContextParameter, ... — Business process
      // comes before Guideline.
      kind: "element",
      name: rsm("ExchangedDocumentContext"),
      children: [
        {
          kind: "element",
          name: ram("BusinessProcessSpecifiedDocumentContextParameter"),
          from: "businessProcessType",
          children: [{ kind: "value", name: ram("ID"), from: "", bt: "BT-23" }],
        },
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
              // Descends into `delivery` so the children use plain relative paths, and renders only when
              // it carries a country: BR-57 requires BT-80 in every deliver-to address, so a delivery that
              // only has a date (BT-72) must not produce an empty ShipToTradeParty/PostalTradeAddress — it
              // did before `when` existed (P-43). Post code and city without a country are dropped with it.
              kind: "element",
              name: ram("ShipToTradeParty"),
              from: "delivery",
              when: "deliverToCountryCode",
              children: [
                {
                  // TradeAddressType sequence: ..., PostcodeCode, ...,
                  // LineOne, LineTwo, ..., CityName, ..., CountryID, ... —
                  // Postcode, address lines and City precede Country.
                  kind: "element",
                  name: ram("PostalTradeAddress"),
                  children: [
                    { kind: "value", name: ram("PostcodeCode"), from: "deliverToPostCode", bt: "BT-78" },
                    { kind: "value", name: ram("LineOne"), from: "deliverToAddressLine1", bt: "BT-75" },
                    { kind: "value", name: ram("LineTwo"), from: "deliverToAddressLine2", bt: "BT-76" },
                    { kind: "value", name: ram("CityName"), from: "deliverToCity", bt: "BT-77" },
                    { kind: "value", name: ram("CountryID"), from: "deliverToCountryCode", bt: "BT-80" },
                  ],
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

/**
 * TradePartyType sequence (shared by seller/buyer/tax-rep): ID, GlobalID,
 * Name, RoleCode, Description, SpecifiedLegalOrganization,
 * DefinedTradeContact, PostalTradeAddress, URIUniversalCommunication,
 * SpecifiedTaxRegistration, ... — Contact comes before the address, and the
 * electronic address comes after the address but before tax registrations.
 */
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
        // BG-6 Seller contact — BR-DE-2 requires the group to exist;
        // TradeContactType sequence: PersonName, ..., TelephoneUniversalCommunication,
        // ..., EmailURIUniversalCommunication, ... (BT-41/42/43, BR-DE-2/6/7).
        kind: "element",
        name: ram("DefinedTradeContact"),
        from: "contact",
        children: [
          { kind: "value", name: ram("PersonName"), from: "name", bt: "BT-41" },
          {
            kind: "element",
            name: ram("TelephoneUniversalCommunication"),
            from: "telephone",
            children: [{ kind: "value", name: ram("CompleteNumber"), from: "", bt: "BT-42" }],
          },
          {
            kind: "element",
            name: ram("EmailURIUniversalCommunication"),
            from: "email",
            children: [{ kind: "value", name: ram("URIID"), from: "", bt: "BT-43" }],
          },
        ],
      },
      {
        kind: "element",
        name: ram("PostalTradeAddress"),
        children: [
          // TradeAddressType sequence: PostcodeCode, ..., LineOne, LineTwo, ..., CityName, ..., CountryID (P-60).
          { kind: "value", name: ram("PostcodeCode"), from: "postCode", bt: "BT-38" },
          { kind: "value", name: ram("LineOne"), from: "addressLine1", bt: "BT-35" },
          { kind: "value", name: ram("LineTwo"), from: "addressLine2", bt: "BT-36" },
          { kind: "value", name: ram("CityName"), from: "city", bt: "BT-37" },
          { kind: "value", name: ram("CountryID"), from: "countryCode", bt: "BT-40" },
        ],
      },
      {
        // Gated with `when`, not `from`: keeping context at the party level (not descending into the
        // address string first) is what lets `schemeID` read `electronicAddressScheme` as a sibling field,
        // not a property of the address string itself — an earlier draft descended first and broke exactly
        // this. Without any gate the wrapper self-closed when `electronicAddress` was absent, and an empty
        // URIUniversalCommunication fails BR-62/BR-63 (P-43).
        kind: "element",
        name: ram("URIUniversalCommunication"),
        when: "electronicAddress",
        children: [
          {
            kind: "value",
            name: ram("URIID"),
            from: "electronicAddress",
            attributes: [{ name: "schemeID", from: "electronicAddressScheme" }],
            bt: "BT-34",
          },
        ],
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
        children: [
          { kind: "value", name: ram("PostcodeCode"), from: "postCode", bt: "BT-53" },
          { kind: "value", name: ram("LineOne"), from: "addressLine1", bt: "BT-50" },
          { kind: "value", name: ram("LineTwo"), from: "addressLine2", bt: "BT-51" },
          { kind: "value", name: ram("CityName"), from: "city", bt: "BT-52" },
          { kind: "value", name: ram("CountryID"), from: "countryCode", bt: "BT-55" },
        ],
      },
      {
        // Same `when` gate as the seller's (BT-34) — see sellerPartyNode.
        kind: "element",
        name: ram("URIUniversalCommunication"),
        when: "electronicAddress",
        children: [
          {
            kind: "value",
            name: ram("URIID"),
            from: "electronicAddress",
            attributes: [{ name: "schemeID", from: "electronicAddressScheme" }],
            bt: "BT-49",
          },
        ],
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
        // BT-62. T-093: found missing (no model field existed at all) by
        // the L4 differential oracle (T-041) — @e-invoice-eu/core's UBL
        // binding requires a party name here, ours had nowhere to put one.
        // TradePartyType's sequence (same type SellerTradeParty/
        // BuyerTradeParty use) places Name before PostalTradeAddress; BR-18
        // requires it whenever BG-11 is present, matching the model field
        // being required (not optional) within TaxRepresentativeParty.
        kind: "value",
        name: ram("Name"),
        from: "name",
        bt: "BT-62",
      },
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
        // BG-16 Payment instruction — BR-DE-1 requires the group to exist
        // (element itself is optional per the base XSD, but the DE profile
        // makes it mandatory in practice). TradeSettlementPaymentMeansType
        // sequence: ..., TypeCode, ..., PayeePartyCreditorFinancialAccount.
        kind: "element",
        name: ram("SpecifiedTradeSettlementPaymentMeans"),
        from: "paymentInstructions",
        children: [
          { kind: "value", name: ram("TypeCode"), from: "meansTypeCode", bt: "BT-81" },
          {
            kind: "element",
            name: ram("PayeePartyCreditorFinancialAccount"),
            from: "accountIdentifier",
            children: [{ kind: "value", name: ram("IBANID"), from: "", bt: "BT-84" }],
          },
        ],
      },
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
        children: [
          { kind: "value", name: ram("IssuerAssignedID"), from: "invoiceNumber", bt: "BT-25" },
          {
            // BT-26. Found missing by the L4 differential oracle
            // (tools/conformance/oracle-e-invoice-eu.mjs, T-041) — the
            // field was modeled but never bound. ReferencedDocumentType's
            // sequence (artifacts/cii-d16b/schema/
            // CrossIndustryInvoice_ReusableAggregateBusinessInformationEntity_100pD16B.xsd)
            // places FormattedIssueDateTime after IssuerAssignedID; its
            // DateTimeString child is qdt:, not udt: (QualifiedDataType.xsd
            // is elementFormDefault="qualified" in the qdt namespace) —
            // same date-102 shape as the header IssueDateTime.
            // `from: "issueDate"` on the element itself (not the value
            // child) so the whole wrapper is omitted when issueDate is
            // absent — DateTimeString is required *within*
            // FormattedIssueDateTime, so an empty self-closing element
            // would be an XSD violation, unlike the usual "render empty
            // container" default for structural elements.
            kind: "element",
            name: ram("FormattedIssueDateTime"),
            from: "issueDate",
            children: [
              {
                kind: "value",
                name: qdt("DateTimeString"),
                from: "",
                format: "date-cii",
                attributes: [{ name: "format", literal: "102" }],
                bt: "BT-26",
              },
            ],
          },
        ],
      },
    ],
  };
}

function currencyAttr() {
  return { name: "currencyID", from: "currencyCode" } as const;
}
