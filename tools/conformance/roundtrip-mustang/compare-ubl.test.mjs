import { test } from "node:test";
import assert from "node:assert/strict";
import { compareUblToModel } from "./compare-ubl.mjs";

const MODEL = {
  number: "RE-1 & Co.",
  issueDate: "2026-09-23",
  typeCode: "380",
  currencyCode: "EUR",
  totals: {
    sumOfLineNetAmounts: "100.00",
    totalAmountWithoutVat: "100.00",
    totalVatAmount: "19.00",
    totalAmountWithVat: "119.00",
    amountDueForPayment: "119.00",
    sumOfAllowances: "0.00",
  },
  vatBreakdown: [{ taxableAmount: "100.00", taxAmount: "19.00", categoryCode: "S", rate: "19" }],
  lines: [{ identifier: "1", quantity: "2", netAmount: "100.00" }],
};

/** Mustang's UBL shape: amounts normalised ("119" for "119.00"), zero amounts left out. */
function ubl({ payable = "119" } = {}) {
  return `<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2">
  <cbc:ID>RE-1 &amp; Co.</cbc:ID>
  <cbc:IssueDate>2026-09-23</cbc:IssueDate>
  <cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>
  <cbc:DocumentCurrencyCode>EUR</cbc:DocumentCurrencyCode>
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="EUR">19</cbc:TaxAmount>
    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="EUR">100</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="EUR">19</cbc:TaxAmount>
      <cac:TaxCategory><cbc:ID>S</cbc:ID><cbc:Percent>19</cbc:Percent></cac:TaxCategory>
    </cac:TaxSubtotal>
  </cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="EUR">100</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="EUR">100</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="EUR">119</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="EUR">${payable}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
  <cac:InvoiceLine>
    <cbc:ID>1</cbc:ID>
    <cbc:InvoicedQuantity unitCode="C62">2</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="EUR">100</cbc:LineExtensionAmount>
  </cac:InvoiceLine>
</Invoice>`;
}

test("every term Mustang read back as written passes — normalised amounts, entities, a zero it left out", () => {
  const checks = compareUblToModel(ubl(), MODEL);
  assert.deepEqual(
    checks.filter((check) => !check.ok),
    [],
  );
  assert.ok(checks.some((check) => check.term === "BT-107 sum of allowances"));
});

test("a total Mustang read differently is reported with both values", () => {
  const mismatches = compareUblToModel(ubl({ payable: "118.99" }), MODEL).filter((c) => !c.ok);
  assert.deepEqual(mismatches, [
    { term: "BT-115 amount due", expected: "119.00", actual: "118.99", ok: false },
  ]);
});

test("a line or VAT group Mustang did not find at all is a mismatch, not a skipped check", () => {
  const model = {
    ...MODEL,
    lines: [...MODEL.lines, { identifier: "2", quantity: "1", netAmount: "5.00" }],
  };
  const terms = compareUblToModel(ubl(), model)
    .filter((c) => !c.ok)
    .map((c) => c.term);
  assert.ok(terms.includes("BG-25 line count"));
  assert.ok(terms.includes("line 2 BT-131 net amount"));
});
