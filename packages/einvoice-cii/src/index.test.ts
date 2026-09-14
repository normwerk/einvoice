import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Invoice } from "@normwerk/einvoice-model";
import { serializeCii } from "./index.js";

const FIXTURES_DIR = fileURLToPath(new URL("../../../fixtures", import.meta.url));

function loadFixture(id: string): Invoice {
  return JSON.parse(readFileSync(resolve(FIXTURES_DIR, id, "input.json"), "utf-8")) as Invoice;
}

describe("serializeCii", () => {
  it("is deterministic: serializing twice gives byte-identical output", () => {
    const invoice = loadFixture("de-b2b-standard");
    const first = serializeCii(invoice, { profile: "en16931-cii" });
    const second = serializeCii(invoice, { profile: "en16931-cii" });
    expect(second.xml).toBe(first.xml);
  });

  it("de-b2b-standard: emits the root element with fixed namespace prefixes", () => {
    const invoice = loadFixture("de-b2b-standard");
    const { xml } = serializeCii(invoice, { profile: "en16931-cii" });
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?><rsm:CrossIndustryInvoice')).toBe(
      true,
    );
    expect(xml).toContain(
      'xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100"',
    );
    expect(xml).toContain(
      'xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100"',
    );
  });

  it("de-b2b-standard: BT-1/BT-2/BT-3/BT-5/BT-24 header fields, in XSD sequence order", () => {
    const invoice = loadFixture("de-b2b-standard");
    const { xml } = serializeCii(invoice, { profile: "en16931-cii" });
    expect(xml).toContain(
      "<ram:GuidelineSpecifiedDocumentContextParameter><ram:ID>urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0</ram:ID></ram:GuidelineSpecifiedDocumentContextParameter>",
    );
    expect(xml).toContain("<ram:ID>RE-2026-0001</ram:ID>"); // BT-1, first <ram:ID> after ExchangedDocument opens
    expect(xml).toContain("<ram:TypeCode>380</ram:TypeCode>");
    expect(xml).toContain('<udt:DateTimeString format="102">20260913</udt:DateTimeString>'); // BT-2, dashes stripped
    expect(xml).toContain("<ram:InvoiceCurrencyCode>EUR</ram:InvoiceCurrencyCode>");
  });

  it("de-b2b-standard: seller/buyer names and seller VAT-ID with scheme", () => {
    const invoice = loadFixture("de-b2b-standard");
    const { xml } = serializeCii(invoice, { profile: "en16931-cii" });
    expect(xml).toContain("<ram:SellerTradeParty><ram:Name>Musterfirma GmbH</ram:Name>");
    expect(xml).toContain('<ram:ID schemeID="VA">DE123456789</ram:ID>');
    expect(xml).toContain("<ram:BuyerTradeParty><ram:Name>Beispielkunde GmbH</ram:Name>");
  });

  it("de-b2b-standard: one invoice line with quantity/unitCode and line VAT", () => {
    const invoice = loadFixture("de-b2b-standard");
    const { xml } = serializeCii(invoice, { profile: "en16931-cii" });
    expect(xml).toContain('<ram:BilledQuantity unitCode="C62">1</ram:BilledQuantity>');
    expect(xml).toContain("<ram:CategoryCode>S</ram:CategoryCode>");
    expect(xml).toContain("<ram:RateApplicablePercent>19</ram:RateApplicablePercent>");
  });

  it("de-b2b-standard: VAT breakdown and document totals", () => {
    const invoice = loadFixture("de-b2b-standard");
    const { xml } = serializeCii(invoice, { profile: "en16931-cii" });
    expect(xml).toContain("<ram:CalculatedAmount>19.00</ram:CalculatedAmount>");
    expect(xml).toContain("<ram:BasisAmount>100.00</ram:BasisAmount>");
    // currencyID belongs only on TaxTotalAmount for this profile (CII-DT-031,
    // confirmed against the real KoSIT validator) — every other *Amount must
    // NOT carry it.
    expect(xml).toContain('<ram:TaxTotalAmount currencyID="EUR">19.00</ram:TaxTotalAmount>');
    expect(xml).toContain("<ram:GrandTotalAmount>119.00</ram:GrandTotalAmount>");
    expect(xml).toContain("<ram:DuePayableAmount>119.00</ram:DuePayableAmount>");
  });

  it("de-b2b-reverse-charge: exemption reason code/text on the VAT breakdown", () => {
    const invoice = loadFixture("de-b2b-reverse-charge");
    const { xml } = serializeCii(invoice, { profile: "en16931-cii" });
    expect(xml).toContain("<ram:ExemptionReasonCode>VATEX-EU-AE</ram:ExemptionReasonCode>");
    expect(xml).toContain("<ram:CategoryCode>AE</ram:CategoryCode>");
  });

  it("de-eu-intracommunity: delivery country and actual delivery date", () => {
    const invoice = loadFixture("de-eu-intracommunity");
    const { xml } = serializeCii(invoice, { profile: "en16931-cii" });
    expect(xml).toContain(
      "<ram:ShipToTradeParty><ram:PostalTradeAddress><ram:PostcodeCode>75001</ram:PostcodeCode><ram:CityName>Paris</ram:CityName><ram:CountryID>FR</ram:CountryID>",
    );
    expect(xml).toContain(
      '<ram:ActualDeliverySupplyChainEvent><ram:OccurrenceDateTime><udt:DateTimeString format="102">20260910</udt:DateTimeString>',
    );
  });

  it("de-credit-note: type code 381 and the preceding invoice reference", () => {
    const invoice = loadFixture("de-credit-note");
    const { xml } = serializeCii(invoice, { profile: "en16931-cii" });
    expect(xml).toContain("<ram:TypeCode>381</ram:TypeCode>");
    // BT-25 + BT-26 (issue date) — the latter found missing by the L4
    // differential oracle (tools/conformance/oracle-e-invoice-eu.mjs,
    // T-041) and fixed in generated/plan.ts.
    expect(xml).toContain(
      '<ram:InvoiceReferencedDocument><ram:IssuerAssignedID>RE-2026-0001</ram:IssuerAssignedID><ram:FormattedIssueDateTime><qdt:DateTimeString format="102">20260913</qdt:DateTimeString></ram:FormattedIssueDateTime></ram:InvoiceReferencedDocument>',
    );
  });

  it("never emits an empty element for a missing optional field", () => {
    const invoice = loadFixture("de-b2b-standard"); // has no delivery, no legal registration ids
    const { xml } = serializeCii(invoice, { profile: "en16931-cii" });
    expect(xml).not.toContain("<ram:SpecifiedLegalOrganization>"); // seller/buyer legalRegistrationIdentifier unset
    expect(xml).not.toContain('<ram:SpecifiedTaxRegistration><ram:ID schemeID="FC">'); // taxRegistrationIdentifier unset
    // ApplicableHeaderTradeDelivery is still mandatory as a container (XSD),
    // but self-closes since this fixture has no delivery data.
    expect(xml).toContain("<ram:ApplicableHeaderTradeDelivery/>");
  });

  it("omits FormattedIssueDateTime entirely (not empty) when a preceding invoice reference has no issue date", () => {
    // DateTimeString is required *within* FormattedIssueDateTime (XSD), so
    // an empty self-closing element there would be invalid — unlike
    // ApplicableHeaderTradeDelivery above, this one must be dropped.
    const invoice = {
      ...loadFixture("de-credit-note"),
      precedingInvoiceReferences: [{ invoiceNumber: "RE-2026-0001" }],
    };
    const { xml } = serializeCii(invoice, { profile: "en16931-cii" });
    expect(xml).toContain(
      "<ram:InvoiceReferencedDocument><ram:IssuerAssignedID>RE-2026-0001</ram:IssuerAssignedID></ram:InvoiceReferencedDocument>",
    );
    expect(xml).not.toContain("FormattedIssueDateTime");
  });

  it("de-document-discount: CalculationPercent (BT-94) before BasisAmount (BT-93), T-027", () => {
    const invoice = loadFixture("de-document-discount");
    const { xml } = serializeCii(invoice, { profile: "en16931-cii" });
    // Order matters — TradeAllowanceChargeType's XSD sequence puts
    // CalculationPercent before BasisAmount, not after.
    expect(xml).toContain(
      "<ram:CalculationPercent>5</ram:CalculationPercent><ram:BasisAmount>1000.00</ram:BasisAmount>",
    );
  });

  it("de-shipping-charge: CalculationPercent is omitted, not emitted empty, when unset", () => {
    const invoice = loadFixture("de-shipping-charge"); // charge has no calculationPercent
    const { xml } = serializeCii(invoice, { profile: "en16931-cii" });
    expect(xml).not.toContain("CalculationPercent");
  });

  it("de-b2b-standard: business process, contact, and electronic address (XRechnung-profile fields, T-021)", () => {
    const invoice = loadFixture("de-b2b-standard");
    const { xml } = serializeCii(invoice, { profile: "en16931-cii" });
    expect(xml).toContain(
      "<ram:BusinessProcessSpecifiedDocumentContextParameter><ram:ID>urn:fdc:peppol.eu:2017:poacc:billing:01:1.0</ram:ID></ram:BusinessProcessSpecifiedDocumentContextParameter>",
    );
    expect(xml).toContain("<ram:BuyerReference>Buchhaltung-2026-09</ram:BuyerReference>");
    expect(xml).toContain(
      "<ram:DefinedTradeContact><ram:PersonName>Rechnungsstelle</ram:PersonName>",
    );
    expect(xml).toContain(
      "<ram:TelephoneUniversalCommunication><ram:CompleteNumber>+493012345678</ram:CompleteNumber></ram:TelephoneUniversalCommunication>",
    );
    expect(xml).toContain(
      "<ram:EmailURIUniversalCommunication><ram:URIID>rechnung@musterfirma.example</ram:URIID></ram:EmailURIUniversalCommunication>",
    );
    expect(xml).toContain(
      '<ram:URIUniversalCommunication><ram:URIID schemeID="EM">rechnung@musterfirma.example</ram:URIID></ram:URIUniversalCommunication>',
    );
    expect(xml).toContain(
      "<ram:PostalTradeAddress><ram:PostcodeCode>10115</ram:PostcodeCode><ram:CityName>Berlin</ram:CityName><ram:CountryID>DE</ram:CountryID></ram:PostalTradeAddress>",
    );
  });

  it("emits BT-158/BT-159 (item classification identifier with @listID='HS', country of origin) when set (T-060 continuation, D-19)", () => {
    const base = loadFixture("de-b2b-standard");
    const [firstLine] = base.lines;
    if (firstLine === undefined) throw new Error("fixture de-b2b-standard has no lines");
    const invoice: Invoice = {
      ...base,
      lines: [{ ...firstLine, hsCode: "847130", originCountry: "CN" }],
    };
    const { xml } = serializeCii(invoice, { profile: "en16931-cii" });
    expect(xml).toContain(
      '<ram:DesignatedProductClassification><ram:ClassCode listID="HS">847130</ram:ClassCode></ram:DesignatedProductClassification>',
    );
    expect(xml).toContain("<ram:OriginTradeCountry><ram:ID>CN</ram:ID></ram:OriginTradeCountry>");
    // DesignatedProductClassification must come before OriginTradeCountry — TradeProductType's own XSD
    // sequence order (artifacts/cii-d16b/schema/..._ReusableAggregateBusinessInformationEntity_100pD16B.xsd).
    expect(xml.indexOf("DesignatedProductClassification")).toBeLessThan(
      xml.indexOf("OriginTradeCountry"),
    );
  });

  it("omits DesignatedProductClassification/OriginTradeCountry entirely when hsCode/originCountry are unset", () => {
    const invoice = loadFixture("de-b2b-standard"); // no hsCode/originCountry on its one line
    const { xml } = serializeCii(invoice, { profile: "en16931-cii" });
    expect(xml).not.toContain("DesignatedProductClassification");
    expect(xml).not.toContain("OriginTradeCountry");
  });
});
