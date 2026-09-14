import { test } from "node:test";
import assert from "node:assert/strict";
import { mapInvoiceToUbl } from "./map-to-ubl.mjs";

const BASE = {
  number: "RE-2026-0001",
  issueDate: "2026-09-13",
  typeCode: "380",
  currencyCode: "EUR",
  specificationIdentifier: "urn:cen.eu:en16931:2017#compliant",
  seller: { name: "Seller GmbH", countryCode: "DE", city: "Berlin", postCode: "10115" },
  buyer: { name: "Buyer GmbH", countryCode: "DE", city: "Hamburg", postCode: "20095" },
  lines: [
    {
      identifier: "1",
      quantity: "1",
      unitCode: "C62",
      netAmount: "100.00",
      netPrice: "100.00",
      itemName: "Widget",
      vat: { categoryCode: "S", rate: "19" },
    },
  ],
  vatBreakdown: [{ taxableAmount: "100.00", taxAmount: "19.00", categoryCode: "S", rate: "19" }],
  totals: {
    sumOfLineNetAmounts: "100.00",
    totalAmountWithoutVat: "100.00",
    totalVatAmount: "19.00",
    totalAmountWithVat: "119.00",
    amountDueForPayment: "119.00",
  },
};

test("maps required header, party, line and totals fields", () => {
  const ubl = mapInvoiceToUbl(BASE)["ubl:Invoice"];
  assert.equal(ubl["cbc:ID"], "RE-2026-0001");
  assert.equal(ubl["cbc:InvoiceTypeCode"], "380");
  assert.equal(
    ubl["cac:AccountingSupplierParty"]["cac:Party"]["cac:PartyLegalEntity"]["cbc:RegistrationName"],
    "Seller GmbH",
  );
  assert.equal(
    ubl["cac:AccountingCustomerParty"]["cac:Party"]["cac:PostalAddress"]["cbc:CityName"],
    "Hamburg",
  );
  assert.equal(ubl["cac:InvoiceLine"][0]["cac:Item"]["cbc:Name"], "Widget");
  assert.equal(ubl["cac:LegalMonetaryTotal"]["cbc:PayableAmount"], "119.00");
  assert.equal(ubl["cac:TaxTotal"][0]["cbc:TaxAmount"], "19.00");
});

test("seller VAT identifier becomes an array-wrapped PartyTaxScheme, buyer's a bare object", () => {
  const invoice = {
    ...BASE,
    seller: { ...BASE.seller, vatIdentifier: "DE123456789" },
    buyer: { ...BASE.buyer, vatIdentifier: "DE987654321" },
  };
  const ubl = mapInvoiceToUbl(invoice)["ubl:Invoice"];
  const sellerScheme = ubl["cac:AccountingSupplierParty"]["cac:Party"]["cac:PartyTaxScheme"];
  const buyerScheme = ubl["cac:AccountingCustomerParty"]["cac:Party"]["cac:PartyTaxScheme"];
  assert.ok(
    Array.isArray(sellerScheme),
    "seller PartyTaxScheme must be an array (per the library's SELLER type)",
  );
  assert.equal(sellerScheme[0]["cbc:CompanyID"], "DE123456789");
  assert.ok(
    !Array.isArray(buyerScheme),
    "buyer PartyTaxScheme must be a bare object (per the library's BUYER type)",
  );
  assert.equal(buyerScheme["cbc:CompanyID"], "DE987654321");
});

test("every mapped Amount@currencyID matches the invoice currency", () => {
  const ubl = mapInvoiceToUbl(BASE)["ubl:Invoice"];
  assert.equal(ubl["cac:InvoiceLine"][0]["cac:Price"]["cbc:PriceAmount@currencyID"], "EUR");
  assert.equal(ubl["cac:LegalMonetaryTotal"]["cbc:PayableAmount@currencyID"], "EUR");
});

test("document-level allowances and charges are merged with the correct ChargeIndicator string", () => {
  const invoice = {
    ...BASE,
    documentLevelAllowances: [
      { amount: "10.00", vatCategoryCode: "S", vatRate: "19", reason: "Volume discount" },
    ],
    documentLevelCharges: [
      { amount: "5.00", vatCategoryCode: "S", vatRate: "19", reason: "Shipping" },
    ],
  };
  const ubl = mapInvoiceToUbl(invoice)["ubl:Invoice"];
  const ac = ubl["cac:AllowanceCharge"];
  assert.equal(ac.length, 2);
  assert.equal(ac[0]["cbc:ChargeIndicator"], "false");
  assert.equal(ac[0]["cbc:AllowanceChargeReason"], "Volume discount");
  assert.equal(ac[1]["cbc:ChargeIndicator"], "true");
});

test("calculationPercent maps to MultiplierFactorNumeric, not cbc:Percent (T-027)", () => {
  const invoice = {
    ...BASE,
    documentLevelAllowances: [
      {
        amount: "50.00",
        baseAmount: "1000.00",
        calculationPercent: "5",
        vatCategoryCode: "S",
        vatRate: "19",
      },
    ],
    lines: [
      {
        ...BASE.lines[0],
        allowances: [{ amount: "10.00", baseAmount: "100.00", calculationPercent: "10" }],
      },
    ],
  };
  const ubl = mapInvoiceToUbl(invoice)["ubl:Invoice"];
  const docAc = ubl["cac:AllowanceCharge"][0];
  assert.equal(docAc["cbc:MultiplierFactorNumeric"], "5");
  assert.ok(!("cbc:Percent" in docAc), "cbc:Percent is TaxCategory's VAT rate, not this field");
  const lineAc = ubl["cac:InvoiceLine"][0]["cac:AllowanceCharge"][0];
  assert.equal(lineAc["cbc:MultiplierFactorNumeric"], "10");
});

test("maps sellerTaxRepresentative to TaxRepresentativeParty (T-093)", () => {
  const invoice = {
    ...BASE,
    sellerTaxRepresentative: { name: "Rep GmbH", vatIdentifier: "DE111111111", countryCode: "DE" },
  };
  const ubl = mapInvoiceToUbl(invoice)["ubl:Invoice"];
  const rep = ubl["cac:TaxRepresentativeParty"];
  assert.equal(rep["cac:PartyName"]["cbc:Name"], "Rep GmbH");
  assert.equal(rep["cac:PostalAddress"]["cac:Country"]["cbc:IdentificationCode"], "DE");
  assert.equal(rep["cac:PartyTaxScheme"]["cbc:CompanyID"], "DE111111111");
});

test("optional header fields are omitted, not emitted as empty/undefined", () => {
  const ubl = mapInvoiceToUbl(BASE)["ubl:Invoice"];
  assert.ok(!("cbc:BuyerReference" in ubl));
  assert.ok(!("cac:Delivery" in ubl));
  assert.ok(!("cac:TaxRepresentativeParty" in ubl));
  assert.ok(!("cac:PaymentMeans" in ubl));
  assert.ok(!("cac:AllowanceCharge" in ubl));
});
