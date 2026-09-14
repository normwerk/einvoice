import { describe, expect, it } from "vitest";
import { validateModel } from "@normwerk/einvoice-model";
import {
  InvalidAssembledInvoiceError,
  MissingCorrectedInvoiceReferenceError,
  MissingDeliveryInfoForIntraCommunitySupplyError,
  MissingDocumentNumberError,
  MissingSellerContactError,
  UnsupportedSchemaVersionError,
  buildInvoice,
} from "./build-invoice.js";
import type { CommerceInvoiceInput } from "./types.js";

const SELLER = {
  name: "Musterfirma GmbH",
  countryCode: "DE" as const,
  city: "Berlin",
  postCode: "10115",
  vatIdentifier: "DE123456789",
  contact: {
    name: "Rechnungsstelle",
    telephone: "+493012345678",
    email: "rechnung@musterfirma.example",
  },
};

function domesticInput(overrides: Partial<CommerceInvoiceInput> = {}): CommerceInvoiceInput {
  return {
    schemaVersion: 1,
    document: { kind: "invoice", number: "RE-2026-0001", issueDate: "2026-09-14", currency: "EUR" },
    seller: SELLER,
    buyer: { name: "Beispielkunde GmbH", countryCode: "DE", city: "Hamburg", postCode: "20095" },
    lines: [
      {
        quantity: "2",
        unitCode: "C62",
        netPrice: "50.00",
        itemName: "Widget",
        taxRateKind: "standard",
      },
    ],
    taxContext: {
      sellerCountry: "DE",
      sellerVatId: "DE123456789",
      buyerCountry: "DE",
      buyerIsBusiness: true,
      ossRegistered: false,
      supplyType: "goods",
    },
    ...overrides,
  };
}

describe("buildInvoice — domestic (docs/tax-semantics.md row 1)", () => {
  it("computes exact totals for a single standard-rate line", () => {
    const result = buildInvoice(domesticInput());
    expect(result.invoice.totals).toEqual({
      sumOfLineNetAmounts: "100.00",
      sumOfAllowances: undefined,
      sumOfCharges: undefined,
      totalAmountWithoutVat: "100.00",
      totalVatAmount: "19.00",
      totalAmountWithVat: "119.00",
      amountDueForPayment: "119.00",
    });
    expect(result.invoice.vatBreakdown).toEqual([
      {
        taxableAmount: "100.00",
        taxAmount: "19.00",
        categoryCode: "S",
        rate: "19",
        exemptionReasonCode: undefined,
        exemptionReasonText: undefined,
      },
    ]);
    expect(result.decisions).toHaveLength(1);
    expect(result.decisions[0]?.ruleId).toBe("tax-semantics#1");
    expect(result.warnings).toEqual([]);
  });

  it("assembles a document that independently passes validateModel() (the same check buildInvoice itself runs)", () => {
    const result = buildInvoice(domesticInput());
    expect(validateModel(result.invoice).valid).toBe(true);
  });

  it("mixed rates on one invoice (row 9): two VAT breakdown groups, shipping/discount on the standard-rate group", () => {
    const input = domesticInput({
      lines: [
        {
          quantity: "2",
          unitCode: "C62",
          netPrice: "50.00",
          itemName: "Widget",
          taxRateKind: "standard",
        },
        {
          quantity: "1",
          unitCode: "C62",
          netPrice: "40.00",
          itemName: "Book",
          taxRateKind: "reduced",
        },
      ],
      shipping: { amount: "10.00", reason: "Shipping" },
      discounts: [{ amount: "5.00", reason: "Loyalty discount" }],
    });
    const result = buildInvoice(input);
    expect(result.invoice.totals).toEqual({
      sumOfLineNetAmounts: "140.00",
      sumOfAllowances: "5.00",
      sumOfCharges: "10.00",
      totalAmountWithoutVat: "145.00",
      totalVatAmount: "22.75",
      totalAmountWithVat: "167.75",
      amountDueForPayment: "167.75",
    });
    const breakdown = [...result.invoice.vatBreakdown].sort(
      (a, b) => Number(b.rate) - Number(a.rate),
    );
    expect(breakdown).toEqual([
      {
        taxableAmount: "105.00",
        taxAmount: "19.95",
        categoryCode: "S",
        rate: "19",
        exemptionReasonCode: undefined,
        exemptionReasonText: undefined,
      },
      {
        taxableAmount: "40.00",
        taxAmount: "2.80",
        categoryCode: "S",
        rate: "7",
        exemptionReasonCode: undefined,
        exemptionReasonText: undefined,
      },
    ]);
    expect(result.warnings.map((w) => w.code)).toContain("shipping-discount-rate-assumption");
  });
});

describe("buildInvoice — intra-EU supply (row 3), needs vatIdEvidence", () => {
  const intraEuInput = domesticInput({
    buyer: {
      name: "Exemple SARL",
      countryCode: "FR",
      city: "Paris",
      postCode: "75008",
      vatIdentifier: "FR12345678901",
    },
    delivery: {
      actualDeliveryDate: "2026-09-10",
      deliverToCountryCode: "FR",
      deliverToCity: "Paris",
      deliverToPostCode: "75001",
    },
    taxContext: {
      sellerCountry: "DE",
      sellerVatId: "DE123456789",
      buyerCountry: "FR",
      buyerVatId: "FR12345678901",
      buyerIsBusiness: true,
      ossRegistered: false,
      supplyType: "goods",
    },
  });
  const evidence = {
    vatId: "FR12345678901",
    status: "valid" as const,
    checkedAt: "2026-09-14",
    consultationNumber: "X1",
  };

  it("produces category K with the VIES evidence echoed back in BuildResult", () => {
    const result = buildInvoice(intraEuInput, { vatIdEvidence: evidence });
    expect(result.invoice.vatBreakdown[0]?.categoryCode).toBe("K");
    expect(result.invoice.vatBreakdown[0]?.exemptionReasonCode).toBe("VATEX-EU-IC");
    expect(result.vatIdEvidence).toEqual(evidence);
    expect(result.invoice.delivery).toEqual(intraEuInput.delivery);
  });

  it("requires delivery.actualDeliveryDate/deliverToCountryCode (BR-IC-11/12 — a real KoSIT rejection found while building this)", () => {
    const withoutDelivery = { ...intraEuInput, delivery: undefined };
    expect(() => buildInvoice(withoutDelivery, { vatIdEvidence: evidence })).toThrow(
      MissingDeliveryInfoForIntraCommunitySupplyError,
    );
  });
});

describe("buildInvoice — credit note (row 10, T-064)", () => {
  it("requires document.correctedInvoice", () => {
    const input = domesticInput({
      document: {
        kind: "credit-note",
        number: "GS-2026-0001",
        issueDate: "2026-09-20",
        currency: "EUR",
      },
    });
    expect(() => buildInvoice(input)).toThrow(MissingCorrectedInvoiceReferenceError);
  });

  it("emits typeCode 381 and a precedingInvoiceReferences entry (BT-25/26)", () => {
    const input = domesticInput({
      document: {
        kind: "credit-note",
        number: "GS-2026-0001",
        issueDate: "2026-09-20",
        currency: "EUR",
        correctedInvoice: { number: "RE-2026-0001", issueDate: "2026-09-14" },
      },
    });
    const result = buildInvoice(input);
    expect(result.invoice.typeCode).toBe("381");
    expect(result.invoice.precedingInvoiceReferences).toEqual([
      { invoiceNumber: "RE-2026-0001", issueDate: "2026-09-14" },
    ]);
  });
});

describe("buildInvoice — input validation", () => {
  it("rejects an unsupported schemaVersion", () => {
    const input = { ...domesticInput(), schemaVersion: 2 as unknown as 1 };
    expect(() => buildInvoice(input)).toThrow(UnsupportedSchemaVersionError);
  });

  it("requires document.number (no numbering allocated internally, ADR-001)", () => {
    const input = domesticInput({
      document: { kind: "invoice", issueDate: "2026-09-14", currency: "EUR" },
    });
    expect(() => buildInvoice(input)).toThrow(MissingDocumentNumberError);
  });

  it("requires seller.contact (BR-DE-2, unconditional — every invoice declares the XRechnung 3.0 CIUS)", () => {
    const input = domesticInput({ seller: { ...SELLER, contact: undefined } });
    expect(() => buildInvoice(input)).toThrow(MissingSellerContactError);
  });

  it("surfaces unmapped-field warnings rather than silently dropping them", () => {
    const input = domesticInput({
      payment: { terms: "Net 30" },
      references: { orderReference: "PO-1", contractReference: "CT-1" },
      customs: { incoterm: "DAP" },
    });
    const result = buildInvoice(input);
    const codes = result.warnings.map((w) => w.code);
    expect(codes).toContain("payment-terms-not-mapped");
    expect(codes).toContain("order-contract-reference-not-mapped");
    expect(codes).toContain("customs-not-mapped");
  });
});

describe("buildInvoice — defends against a malformed non-TypeScript caller (ADR-003)", () => {
  it("InvalidAssembledInvoiceError would fire for an assembly that produces a structurally invalid Invoice", () => {
    // A currency code outside the real ISO 4217 CurrencyCode enum (confirmed absent, not guessed — "XXX" is
    // itself a real ISO 4217 code, "no currency", and would have made this test a false negative), arriving
    // as plain JSON from a non-TS caller.
    const input = domesticInput({
      document: {
        kind: "invoice",
        number: "RE-1",
        issueDate: "2026-09-14",
        currency: "ZZZ" as never,
      },
    });
    expect(() => buildInvoice(input)).toThrow(InvalidAssembledInvoiceError);
  });
});
