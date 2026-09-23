import { describe, expect, it } from "vitest";
import { validateModel } from "@normwerk/einvoice-model";
import {
  InvalidAssembledInvoiceError,
  InvalidCommerceInvoiceInputError,
  InvalidLeitwegIdError,
  MissingBuyerIdentifierForReverseChargeError,
  MissingBuyerVatIdError,
  MissingBuyerVatIdForCrossBorderServiceError,
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

  it("refuses when the document's buyer VAT-ID (BT-48) is not the one the tax decision was made on (P-44)", () => {
    const mismatched = {
      ...intraEuInput,
      buyer: { ...intraEuInput.buyer, vatIdentifier: "FR99999999999" },
    };
    expect(() => buildInvoice(mismatched, { vatIdEvidence: evidence })).toThrow(
      expect.objectContaining({ name: "TaxRuleError", ruleId: "tax-semantics#3" }),
    );
  });

  it("refuses K when the goods are not delivered to another member state — DE or a third country (§6a Abs. 1 Nr. 1 UStG, P-44)", () => {
    for (const deliverToCountryCode of ["DE", "CH"] as const) {
      const input = {
        ...intraEuInput,
        delivery: { ...intraEuInput.delivery, deliverToCountryCode },
      };
      expect(() => buildInvoice(input, { vatIdEvidence: evidence })).toThrow(
        expect.objectContaining({ name: "TaxRuleError", ruleId: "tax-semantics#3" }),
      );
    }
  });

  it("requires buyer.vatIdentifier on the document itself, not just a positive VIES check (BR-IC-02, P-19)", () => {
    const withoutBuyerVatId = {
      ...intraEuInput,
      buyer: { ...intraEuInput.buyer, vatIdentifier: undefined },
    };
    expect(() => buildInvoice(withoutBuyerVatId, { vatIdEvidence: evidence })).toThrow(
      MissingBuyerVatIdError,
    );
  });
});

describe("buildInvoice — domestic reverse charge (row 5), needs buyer.vatIdentifier and/or legalRegistrationIdentifier", () => {
  function reverseChargeInput(buyer: CommerceInvoiceInput["buyer"]): CommerceInvoiceInput {
    return domesticInput({
      buyer,
      taxContext: {
        sellerCountry: "DE",
        sellerVatId: "DE123456789",
        buyerCountry: "DE",
        buyerIsBusiness: true,
        ossRegistered: false,
        supplyType: "services",
        regimeOverride: { kind: "reverse-charge" },
      },
    });
  }

  it("accepts buyer.vatIdentifier alone", () => {
    const result = buildInvoice(
      reverseChargeInput({
        name: "Bau-Subunternehmer GmbH",
        countryCode: "DE",
        city: "Hamburg",
        postCode: "20095",
        vatIdentifier: "DE987654321",
      }),
    );
    expect(result.invoice.vatBreakdown[0]?.categoryCode).toBe("AE");
  });

  it("accepts buyer.legalRegistrationIdentifier alone", () => {
    const result = buildInvoice(
      reverseChargeInput({
        name: "Bau-Subunternehmer GmbH",
        countryCode: "DE",
        city: "Hamburg",
        postCode: "20095",
        legalRegistrationIdentifier: "HRB 12345",
      }),
    );
    expect(result.invoice.vatBreakdown[0]?.categoryCode).toBe("AE");
  });

  it("requires at least one of the two (BR-AE-02, P-19)", () => {
    const input = reverseChargeInput({
      name: "Bau-Subunternehmer GmbH",
      countryCode: "DE",
      city: "Hamburg",
      postCode: "20095",
    });
    expect(() => buildInvoice(input)).toThrow(MissingBuyerIdentifierForReverseChargeError);
  });
});

describe("buildInvoice — export (row 4) is decided by where the goods go, not only by who buys (P-44)", () => {
  function exportInput(deliverToCountryCode: "CH" | "DE" | "FR"): CommerceInvoiceInput {
    return domesticInput({
      buyer: { name: "Muster AG", countryCode: "CH", city: "Zürich", postCode: "8001" },
      delivery: { deliverToCountryCode },
      taxContext: {
        sellerCountry: "DE",
        sellerVatId: "DE123456789",
        buyerCountry: "CH",
        buyerIsBusiness: true,
        ossRegistered: false,
        supplyType: "goods",
      },
    });
  }

  it("goods delivered to the non-EU buyer's country → G", () => {
    expect(buildInvoice(exportInput("CH")).invoice.vatBreakdown[0]?.categoryCode).toBe("G");
  });

  it("refuses G when the goods stay inside the EU — a non-EU buyer does not make it an export (§6 Abs. 1 UStG)", () => {
    for (const country of ["DE", "FR"] as const) {
      expect(() => buildInvoice(exportInput(country))).toThrow(
        expect.objectContaining({ name: "TaxRuleError", ruleId: "tax-semantics#4" }),
      );
    }
  });
});

describe("buildInvoice — cross-border B2B service under reverse charge (row 12), needs buyer.vatIdentifier (P-47)", () => {
  function crossBorderServiceInput(buyer: CommerceInvoiceInput["buyer"]): CommerceInvoiceInput {
    return domesticInput({
      buyer,
      taxContext: {
        sellerCountry: "DE",
        sellerVatId: "DE123456789",
        buyerCountry: "FR",
        buyerVatId: "FR12345678901",
        buyerIsBusiness: true,
        ossRegistered: false,
        supplyType: "services",
        regimeOverride: { kind: "reverse-charge-cross-border" },
      },
    });
  }
  const FR_BUYER = {
    name: "Client SARL",
    countryCode: "FR" as const,
    city: "Paris",
    postCode: "75001",
  };

  it("accepts buyer.vatIdentifier", () => {
    const result = buildInvoice(
      crossBorderServiceInput({ ...FR_BUYER, vatIdentifier: "FR12345678901" }),
    );
    expect(result.invoice.vatBreakdown[0]?.categoryCode).toBe("AE");
  });

  it("refuses buyer.legalRegistrationIdentifier alone — §14a Abs. 1 UStG needs both parties' VAT-IDs, stricter than BR-AE-02", () => {
    const input = crossBorderServiceInput({
      ...FR_BUYER,
      legalRegistrationIdentifier: "RCS Paris 123",
    });
    expect(() => buildInvoice(input)).toThrow(MissingBuyerVatIdForCrossBorderServiceError);
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

describe("buildInvoice — Leitweg-ID validation (T-062)", () => {
  it("accepts a valid Leitweg-ID buyerReference", () => {
    const input = domesticInput({ references: { buyerReference: "991-ABC-29" } });
    const result = buildInvoice(input);
    expect(result.invoice.buyerReference).toBe("991-ABC-29");
  });

  it("rejects a Leitweg-ID-shaped buyerReference with a wrong check digit", () => {
    const input = domesticInput({ references: { buyerReference: "991-ABD-29" } });
    expect(() => buildInvoice(input)).toThrow(InvalidLeitwegIdError);
  });

  it("does not touch an ordinary free-text buyerReference that doesn't look like a Leitweg-ID", () => {
    const input = domesticInput({ references: { buyerReference: "Buchhaltung-2026-09" } });
    const result = buildInvoice(input);
    expect(result.invoice.buyerReference).toBe("Buchhaltung-2026-09");
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
      payment: { means: "58", terms: "Net 30" },
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

describe("buildInvoice — BT-158/BT-159 (T-060 continuation, D-19)", () => {
  it("maps lines[].hsCode/originCountry per line, leaving lines without them untouched", () => {
    const input = domesticInput({
      lines: [
        {
          quantity: "1",
          unitCode: "C62",
          netPrice: "50.00",
          itemName: "Installation service",
          taxRateKind: "standard",
        },
        {
          quantity: "2",
          unitCode: "C62",
          netPrice: "450.00",
          itemName: "Portable data-processing machine",
          taxRateKind: "standard",
          hsCode: "847130",
          originCountry: "CN",
        },
      ],
    });
    const result = buildInvoice(input);
    expect(result.invoice.lines[0]?.hsCode).toBeUndefined();
    expect(result.invoice.lines[0]?.originCountry).toBeUndefined();
    expect(result.invoice.lines[1]?.hsCode).toBe("847130");
    expect(result.invoice.lines[1]?.originCountry).toBe("CN");
  });

  it("input.customs (incoterm/EORI/IOSS) still warns unmapped, distinct from the now-mapped BT-158/159", () => {
    const input = domesticInput({ customs: { incoterm: "DAP" } });
    const result = buildInvoice(input);
    const warning = result.warnings.find((w) => w.code === "customs-not-mapped");
    expect(warning?.message).toContain("incoterm/sellerEori/buyerEori/iossNumber");
    expect(warning?.message).not.toContain("BT-158/159 and related");
  });
});

describe("buildInvoice — defends against a malformed non-TypeScript caller (ADR-003, T-060)", () => {
  it("a currency code outside ISO 4217 is now caught by the structural gate, not deep in assembly", () => {
    // A currency code outside the real ISO 4217 CurrencyCode enum (confirmed absent, not guessed — "XXX" is
    // itself a real ISO 4217 code, "no currency", and would have made this test a false negative), arriving
    // as plain JSON from a non-TS caller. Before T-060's JSON Schema this reached InvalidAssembledInvoiceError
    // deep inside tax logic; now it is rejected at the door, before any of that logic runs.
    const input = domesticInput({
      document: {
        kind: "invoice",
        number: "RE-1",
        issueDate: "2026-09-14",
        currency: "ZZZ" as never,
      },
    });
    expect(() => buildInvoice(input)).toThrow(InvalidCommerceInvoiceInputError);
  });

  it("rejects an unknown top-level property a hand-built payload might carry by typo", () => {
    const input = {
      ...domesticInput(),
      documnet: domesticInput().document,
    } as CommerceInvoiceInput;
    expect(() => buildInvoice(input)).toThrow(InvalidCommerceInvoiceInputError);
  });

  it(
    "InvalidAssembledInvoiceError still exists as a defence-in-depth check after the structural gate — an " +
      "empty lines array is structurally valid input (types.ts has no minItems on `lines`) but assembles an " +
      "Invoice that fails @normwerk/einvoice-model's own schema (minItems: 1 there)",
    () => {
      const input = domesticInput({ lines: [] });
      expect(() => buildInvoice(input)).toThrow(InvalidAssembledInvoiceError);
    },
  );
});
