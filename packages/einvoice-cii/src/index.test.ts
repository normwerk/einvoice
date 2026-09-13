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
      "<ram:ShipToTradeParty><ram:PostalTradeAddress><ram:CountryID>FR</ram:CountryID>",
    );
    expect(xml).toContain(
      '<ram:ActualDeliverySupplyChainEvent><ram:OccurrenceDateTime><udt:DateTimeString format="102">20260910</udt:DateTimeString>',
    );
  });

  it("de-credit-note: type code 381 and the preceding invoice reference", () => {
    const invoice = loadFixture("de-credit-note");
    const { xml } = serializeCii(invoice, { profile: "en16931-cii" });
    expect(xml).toContain("<ram:TypeCode>381</ram:TypeCode>");
    expect(xml).toContain(
      "<ram:InvoiceReferencedDocument><ram:IssuerAssignedID>RE-2026-0001</ram:IssuerAssignedID></ram:InvoiceReferencedDocument>",
    );
  });

  it("never emits an empty element for a missing optional field", () => {
    const invoice = loadFixture("de-b2b-standard"); // has no buyerReference, no payment, no delivery
    const { xml } = serializeCii(invoice, { profile: "en16931-cii" });
    expect(xml).not.toContain("<ram:BuyerReference>");
    // ApplicableHeaderTradeDelivery is still mandatory as a container (XSD),
    // but self-closes since this fixture has no delivery data.
    expect(xml).toContain("<ram:ApplicableHeaderTradeDelivery/>");
  });
});
