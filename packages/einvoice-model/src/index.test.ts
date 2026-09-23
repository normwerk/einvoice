import { describe, expect, it } from "vitest";
import { validateModel, type Invoice } from "./index.js";

// Scenario 1 from docs/tax-semantics.md: DE -> DE B2B, standard rate.
// Not one of the T-050 fixtures yet (those get their own scenario.md and
// golden files) — this is a smoke test proving the generated schema
// actually accepts a realistic invoice, not just an empty object.
const domesticStandardRateInvoice: Invoice = {
  number: "2026-0913-001",
  issueDate: "2026-09-13",
  typeCode: "380",
  currencyCode: "EUR",
  specificationIdentifier: "urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0",
  seller: {
    name: "Musterfirma GmbH",
    vatIdentifier: "DE123456789",
    countryCode: "DE",
    city: "Berlin",
    postCode: "10115",
  },
  buyer: {
    name: "Beispielkunde GmbH",
    countryCode: "DE",
    city: "Hamburg",
    postCode: "20095",
  },
  lines: [
    {
      identifier: "1",
      quantity: "1",
      unitCode: "C62",
      netAmount: "100.00",
      netPrice: "100.00",
      itemName: "Consulting services",
      vat: { categoryCode: "S", rate: "19" },
    },
  ],
  vatBreakdown: [{ taxableAmount: "100.00", taxAmount: "19.00", categoryCode: "S", rate: "19" }],
  totals: {
    sumOfLineNetAmounts: "100.00",
    totalAmountWithoutVat: "100.00",
    totalAmountWithVat: "119.00",
    amountDueForPayment: "119.00",
  },
};

describe("validateModel", () => {
  it("accepts a realistic domestic standard-rate invoice", () => {
    const result = validateModel(domesticStandardRateInvoice);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it("rejects what the first, hand-picked schema let through (P-53)", () => {
    const line = domesticStandardRateInvoice.lines[0];
    if (line === undefined) throw new Error("the invoice above has a line");
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- deliberately discarding `seller`
    const { seller, ...withoutSeller } = domesticStandardRateInvoice;
    const broken: readonly [unknown, string][] = [
      [withoutSeller, "must have required property 'seller'"],
      [
        { ...domesticStandardRateInvoice, lines: [{ ...line, netAmount: "1,5e3" }] },
        "/lines/0/netAmount must match pattern",
      ],
      [
        { ...domesticStandardRateInvoice, lines: [{ ...line, quantity: "abc" }] },
        "/lines/0/quantity must match pattern",
      ],
      [
        { ...domesticStandardRateInvoice, lines: [{ ...line, unitCode: "NOPE" }] },
        "/lines/0/unitCode must be equal to one of the allowed values",
      ],
      [
        { ...domesticStandardRateInvoice, buyerRefernce: "typo" },
        "must NOT have additional properties",
      ],
    ];
    for (const [invoice, error] of broken) {
      const result = validateModel(invoice);
      expect(result.valid).toBe(false);
      expect(result.errors.join("\n")).toContain(error);
    }
  });

  it("rejects an invoice missing a required field", () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- deliberately discarding `totals`
    const { totals, ...withoutTotals } = domesticStandardRateInvoice;
    const result = validateModel(withoutTotals);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("rejects a VAT category code outside the EN 16931 UNCL 5305 subset", () => {
    const invalid = {
      ...domesticStandardRateInvoice,
      vatBreakdown: [{ ...domesticStandardRateInvoice.vatBreakdown[0], categoryCode: "X" }],
    };
    const result = validateModel(invalid);
    expect(result.valid).toBe(false);
  });

  it("types BT-81 as mandatory inside payment instructions — BR-49 (P-43)", () => {
    // @ts-expect-error -- deliberate: BG-16 without BT-81 must not type-check (BR-49 "shall specify").
    const withoutMeans: NonNullable<Invoice["paymentInstructions"]> = { accountIdentifier: "DE89" };
    expect(withoutMeans.accountIdentifier).toBe("DE89");
  });

  it("rejects a non-object", () => {
    expect(validateModel(null).valid).toBe(false);
    expect(validateModel("not an invoice").valid).toBe(false);
  });
});
