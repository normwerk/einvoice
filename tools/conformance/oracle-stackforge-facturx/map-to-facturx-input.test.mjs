import { test } from "node:test";
import assert from "node:assert/strict";
import { mapInvoiceToFacturXInput } from "./map-to-facturx-input.mjs";

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

test("maps required header, party, line and totals fields, amounts as numbers not strings", () => {
  const input = mapInvoiceToFacturXInput(BASE);
  assert.equal(input.document.id, "RE-2026-0001");
  assert.equal(input.document.typeCode, "380");
  assert.equal(input.seller.name, "Seller GmbH");
  assert.equal(input.buyer.address.city, "Hamburg");
  assert.equal(input.lines[0].name, "Widget");
  assert.equal(input.lines[0].lineTotal, 100);
  assert.equal(typeof input.lines[0].lineTotal, "number");
  assert.equal(input.totals.duePayableAmount, 119);
  assert.equal(input.vatBreakdown[0].taxAmount, 19);
});

test("payment accountIdentifier maps to iban, not the generic accountId", () => {
  const invoice = {
    ...BASE,
    paymentInstructions: { meansTypeCode: "58", accountIdentifier: "DE89370400440532013000" },
  };
  const input = mapInvoiceToFacturXInput(invoice);
  assert.equal(input.payment.iban, "DE89370400440532013000");
  assert.ok(!("accountId" in input.payment));
});

test("seller VAT identifier and tax registration identifier become separate taxRegistrations entries", () => {
  const invoice = {
    ...BASE,
    seller: {
      ...BASE.seller,
      vatIdentifier: "DE123456789",
      taxRegistrationIdentifier: "12/345/67890",
    },
  };
  const input = mapInvoiceToFacturXInput(invoice);
  assert.deepEqual(input.seller.taxRegistrations, [
    { id: "DE123456789", schemeId: "VA" },
    { id: "12/345/67890", schemeId: "FC" },
  ]);
});

test("document-level allowances and charges are merged with the correct isCharge flag", () => {
  const invoice = {
    ...BASE,
    documentLevelAllowances: [
      { amount: "10.00", vatCategoryCode: "S", vatRate: "19", reason: "Volume discount" },
    ],
    documentLevelCharges: [
      { amount: "5.00", vatCategoryCode: "S", vatRate: "19", reason: "Shipping" },
    ],
  };
  const input = mapInvoiceToFacturXInput(invoice);
  assert.equal(input.allowancesCharges.length, 2);
  assert.equal(input.allowancesCharges[0].isCharge, false);
  assert.equal(input.allowancesCharges[0].amount, 10);
  assert.equal(input.allowancesCharges[1].isCharge, true);
});

test("calculationPercent maps to the numeric 'percent' field, not vatRatePercent (T-027)", () => {
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
  };
  const input = mapInvoiceToFacturXInput(invoice);
  assert.equal(input.allowancesCharges[0].percent, 5);
  assert.equal(typeof input.allowancesCharges[0].percent, "number");
  assert.equal(input.allowancesCharges[0].vatRatePercent, 19);
});

test("refuses to map line-level allowances/charges (BG-27/28, no equivalent field)", () => {
  const invoice = {
    ...BASE,
    lines: [{ ...BASE.lines[0], allowances: [{ amount: "10.00", reason: "x" }] }],
  };
  assert.throws(() => mapInvoiceToFacturXInput(invoice), /line-level allowances\/charges/);
});

test("maps sellerTaxRepresentative (T-093), with empty (not undefined) address fields we don't model", () => {
  const invoice = {
    ...BASE,
    sellerTaxRepresentative: { name: "Rep GmbH", vatIdentifier: "DE111111111", countryCode: "DE" },
  };
  const input = mapInvoiceToFacturXInput(invoice);
  assert.equal(input.sellerTaxRepresentative.name, "Rep GmbH");
  assert.equal(input.sellerTaxRepresentative.address.country, "DE");
  // "" not undefined: the library's address builder throws a TypeError on
  // undefined (confirmed empirically) — see the comment in
  // map-to-facturx-input.mjs's mapTaxRepresentative().
  assert.equal(input.sellerTaxRepresentative.address.city, "");
  assert.deepEqual(input.sellerTaxRepresentative.taxRegistrations, [
    { id: "DE111111111", schemeId: "VA" },
  ]);
});

test("preceding invoice reference maps to a 'preceding' typed reference", () => {
  const invoice = {
    ...BASE,
    precedingInvoiceReferences: [{ invoiceNumber: "RE-2026-0001", issueDate: "2026-09-13" }],
  };
  const input = mapInvoiceToFacturXInput(invoice);
  assert.deepEqual(input.references, [
    { id: "RE-2026-0001", type: "preceding", issueDate: "2026-09-13" },
  ]);
});

test("optional header fields are omitted, not emitted as empty/undefined", () => {
  const input = mapInvoiceToFacturXInput(BASE);
  assert.ok(!("buyerReference" in input.document));
  assert.ok(!("delivery" in input));
  assert.ok(!("payment" in input));
  assert.ok(!("allowancesCharges" in input));
  assert.ok(!("references" in input));
});
