import { describe, expect, it } from "vitest";
import { validateModel } from "@normwerk/einvoice-model";
import {
  DuplicateBuyerReferenceError,
  InvalidAssembledInvoiceError,
  InvalidCommerceInvoiceInputError,
  InvalidLeitwegIdError,
  InvalidPriceBasisError,
  LineAllowanceExceedsLineAmountError,
  MissingBuyerIdentifierForReverseChargeError,
  MissingBuyerVatIdError,
  MissingBuyerVatIdForCrossBorderServiceError,
  MissingCorrectedInvoiceReferenceError,
  MissingDeliveryInfoForIntraCommunitySupplyError,
  MissingDocumentNumberError,
  MissingElectronicAddressError,
  MissingSellerAddressError,
  MissingSellerContactError,
  UnsupportedSchemaVersionError,
  buildInvoice,
} from "./build-invoice.js";
import type { CommerceInvoiceInput } from "./types.js";

const SELLER = {
  name: "Musterfirma GmbH",
  countryCode: "DE" as const,
  addressLine1: "Musterstraße 1",
  city: "Berlin",
  postCode: "10115",
  vatIdentifier: "DE123456789",
  electronicAddress: "rechnung@musterfirma.example",
  electronicAddressScheme: "EM" as const,
  contact: {
    name: "Rechnungsstelle",
    telephone: "+493012345678",
    email: "rechnung@musterfirma.example",
  },
};

/** Every buyer below gets an electronic address unless it sets one (or `undefined`) itself — XRechnung
 * requires one on every invoice (PEPPOL-EN16931-R010). */
const BUYER_ELECTRONIC_ADDRESS = {
  electronicAddress: "einkauf@kunde.example",
  electronicAddressScheme: "EM" as const,
};

function domesticInput(overrides: Partial<CommerceInvoiceInput> = {}): CommerceInvoiceInput {
  const input: CommerceInvoiceInput = {
    schemaVersion: 1,
    document: { kind: "invoice", number: "RE-2026-0001", issueDate: "2026-09-14", currency: "EUR" },
    seller: SELLER,
    buyer: {
      name: "Beispielkunde GmbH",
      countryCode: "DE",
      addressLine1: "Beispielweg 2",
      city: "Hamburg",
      postCode: "20095",
    },
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
  return { ...input, buyer: { ...BUYER_ELECTRONIC_ADDRESS, ...input.buyer } };
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

  it("mixed rates on one invoice (row 9): shipping and a document discount split across the rates in proportion to the lines (P-65)", () => {
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
    // Lines: 100.00 at 19%, 40.00 at 7% — shipping 10.00 splits 7.14 / 2.86, the discount 5.00 splits
    // 3.57 / 1.43 (the cent rounding leaves goes to the larger remainder).
    expect(result.invoice.documentLevelCharges).toEqual([
      {
        amount: "7.14",
        vatCategoryCode: "S",
        vatRate: "19",
        reason: "Shipping (anteilig 19 %)",
      },
      { amount: "2.86", vatCategoryCode: "S", vatRate: "7", reason: "Shipping (anteilig 7 %)" },
    ]);
    expect(result.invoice.documentLevelAllowances).toEqual([
      {
        amount: "3.57",
        vatCategoryCode: "S",
        vatRate: "19",
        reason: "Loyalty discount (anteilig 19 %)",
      },
      {
        amount: "1.43",
        vatCategoryCode: "S",
        vatRate: "7",
        reason: "Loyalty discount (anteilig 7 %)",
      },
    ]);
    expect(result.invoice.totals).toEqual({
      sumOfLineNetAmounts: "140.00",
      sumOfAllowances: "5.00",
      sumOfCharges: "10.00",
      totalAmountWithoutVat: "145.00",
      totalVatAmount: "22.58",
      totalAmountWithVat: "167.58",
      amountDueForPayment: "167.58",
    });
    const byRate = Object.fromEntries(
      result.invoice.vatBreakdown.map((g) => [g.rate, [g.taxableAmount, g.taxAmount]]),
    );
    expect(byRate).toEqual({ "19": ["103.57", "19.68"], "7": ["41.43", "2.90"] });
    expect(result.warnings).toEqual([]);
    expect(validateModel(result.invoice).valid).toBe(true);
  });

  it("mixed rates with prices including VAT: the gross shipping is split in the same proportion, VAT taken out per rate (P-65)", () => {
    const result = buildInvoice(
      domesticInput({
        lines: [
          {
            quantity: "1",
            unitCode: "C62",
            priceInclVat: "119.00",
            itemName: "Widget",
            taxRateKind: "standard",
          },
          {
            quantity: "1",
            unitCode: "C62",
            priceInclVat: "42.80",
            itemName: "Book",
            taxRateKind: "reduced",
          },
        ],
        shipping: { amountInclVat: "10.00", reason: "Shipping" },
      }),
    );
    // Net weights 100.00 : 40.00 — the gross 10.00 splits 7.14 / 2.86, netting 6.00 at 19% and 2.67 at 7%.
    expect(result.invoice.documentLevelCharges?.map((c) => [c.vatRate, c.amount])).toEqual([
      ["19", "6.00"],
      ["7", "2.67"],
    ]);
    expect(result.invoice.totals.totalAmountWithVat).toBe("171.80");
    expect(validateModel(result.invoice).valid).toBe(true);
  });

  it("splits shipping by the whole order's rates when the document invoices one shipment of it (P-67)", () => {
    const book = {
      quantity: "1",
      unitCode: "C62",
      netPrice: "100.00",
      itemName: "Book",
      taxRateKind: "reduced" as const,
    };
    const lamp = { ...book, itemName: "Lamp", taxRateKind: "standard" as const };
    const result = buildInvoice(
      domesticInput({
        lines: [book],
        chargeSplitLines: [book, lamp],
        shipping: { amount: "10.00", reason: "Versand / Shipping" },
      }),
    );
    expect(
      result.invoice.documentLevelCharges?.map((c) => [c.vatRate, c.amount, c.reason]),
    ).toEqual([
      ["7", "5.00", "Versand / Shipping (anteilig 7 %)"],
      ["19", "5.00", "Versand / Shipping (anteilig 19 %)"],
    ]);
    expect(result.invoice.vatBreakdown.map((g) => [g.rate, g.taxableAmount, g.taxAmount])).toEqual([
      ["7", "105.00", "7.35"],
      ["19", "5.00", "0.95"],
    ]);
    expect(result.invoice.lines).toHaveLength(1);
    expect(validateModel(result.invoice).valid).toBe(true);
  });

  it("states what the buyer already paid (BT-113) and leaves the rest due (BT-115) (P-67)", () => {
    const paid = buildInvoice(domesticInput({ paidAmount: "119.00" }));
    expect(paid.invoice.totals).toMatchObject({
      totalAmountWithVat: "119.00",
      paidAmount: "119.00",
      amountDueForPayment: "0.00",
    });
    expect(validateModel(paid.invoice).valid).toBe(true);
    const part = buildInvoice(domesticInput({ paidAmount: "19.00" }));
    expect(part.invoice.totals.amountDueForPayment).toBe("100.00");
    expect(() => buildInvoice(domesticInput({ paidAmount: "119.01" }))).toThrow(
      expect.objectContaining({ code: "INVALID_PAID_AMOUNT" }),
    );
  });

  it("refuses to split shipping across rates whose lines add up to zero — there is no proportion (P-65)", () => {
    expect(() =>
      buildInvoice(
        domesticInput({
          lines: [
            {
              quantity: "1",
              unitCode: "C62",
              netPrice: "0.00",
              itemName: "Sample",
              taxRateKind: "standard",
            },
            {
              quantity: "1",
              unitCode: "C62",
              netPrice: "0.00",
              itemName: "Leaflet",
              taxRateKind: "reduced",
            },
          ],
          shipping: { amount: "5.00", reason: "Shipping" },
        }),
      ),
    ).toThrow(/cannot be split across the invoice's VAT rates/);
  });
});

describe("buildInvoice — shipping/discounts take the rate of the supply they belong to (P-40)", () => {
  const BOOK = {
    quantity: "2",
    unitCode: "C62",
    netPrice: "20.00",
    itemName: "Book",
    taxRateKind: "reduced" as const,
  };

  it("an all-reduced-rate basket taxes its shipping at 7%, not 19% (§10 Abs. 1 UStG: ancillary supply)", () => {
    const result = buildInvoice(
      domesticInput({ lines: [BOOK], shipping: { amount: "5.00", reason: "Shipping" } }),
    );
    expect(result.invoice.documentLevelCharges?.[0]?.vatRate).toBe("7");
    expect(result.invoice.vatBreakdown).toEqual([
      expect.objectContaining({ taxableAmount: "45.00", taxAmount: "3.15", rate: "7" }),
    ]);
    expect(result.warnings.map((w) => w.code)).not.toContain("shipping-discount-rate-assumption");
  });

  it("an all-reduced-rate basket takes a document discount off the 7% base instead of crashing on an empty 19% one", () => {
    const result = buildInvoice(
      domesticInput({ lines: [BOOK], discounts: [{ amount: "10.00", reason: "Voucher" }] }),
    );
    expect(result.invoice.documentLevelAllowances?.[0]?.vatRate).toBe("7");
    expect(result.invoice.vatBreakdown).toEqual([
      expect.objectContaining({ taxableAmount: "30.00", taxAmount: "2.10", rate: "7" }),
    ]);
  });

  it("an OSS distance sale taxes its shipping at the destination rate, not Germany's", () => {
    const result = buildInvoice(
      domesticInput({
        buyer: { name: "Jeanne Martin", countryCode: "FR", city: "Paris", postCode: "75001" },
        shipping: { amount: "10.00", reason: "Shipping" },
        taxContext: {
          sellerCountry: "DE",
          sellerVatId: "DE123456789",
          buyerCountry: "FR",
          buyerIsBusiness: false,
          ossRegistered: true,
          ossRateOverride: "20",
          supplyType: "goods",
        },
      }),
    );
    expect(result.invoice.documentLevelCharges?.[0]?.vatRate).toBe("20");
    expect(result.invoice.vatBreakdown).toEqual([
      expect.objectContaining({ taxableAmount: "110.00", taxAmount: "22.00", rate: "20" }),
    ]);
  });

  it("a line charged at a rate it cannot be invoiced at is refused, naming the line (P-50)", () => {
    const input = domesticInput({
      lines: [
        {
          quantity: "1",
          unitCode: "C62",
          netPrice: "10.00",
          itemName: "Book",
          chargedVatRate: "7",
        },
        { quantity: "1", unitCode: "C62", netPrice: "10.00", itemName: "Mug", chargedVatRate: "0" },
      ],
    });
    expect(() => buildInvoice(input)).toThrow(/^Line 2: A domestic line was charged 0% VAT/);
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
      expect.objectContaining({
        name: "TaxRuleError",
        ruleId: "tax-semantics#3",
        code: "BUYER_VAT_ID_MISMATCH",
      }),
    );
  });

  it("refuses K when the goods are not delivered to another member state — DE or a third country (§6a Abs. 1 Nr. 1 UStG, P-44)", () => {
    for (const deliverToCountryCode of ["DE", "CH"] as const) {
      const input = {
        ...intraEuInput,
        delivery: { ...intraEuInput.delivery, deliverToCountryCode },
      };
      expect(() => buildInvoice(input, { vatIdEvidence: evidence })).toThrow(
        expect.objectContaining({
          name: "TaxRuleError",
          ruleId: "tax-semantics#3",
          code: "DELIVERY_NOT_INTRA_EU",
        }),
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

describe("buildInvoice — line-level discounts (BG-27, P-39)", () => {
  const WIDGET = {
    quantity: "2",
    unitCode: "C62",
    netPrice: "50.00",
    itemName: "Widget",
    taxRateKind: "standard" as const,
  };
  const BOOK = {
    quantity: "1",
    unitCode: "C62",
    netPrice: "40.00",
    itemName: "Book",
    taxRateKind: "reduced" as const,
  };

  it("reduces the line's own net amount and emits it as a line allowance with its reason (BR-41/BR-42)", () => {
    const result = buildInvoice(
      domesticInput({
        lines: [{ ...WIDGET, allowances: [{ amount: "15.00", reason: "SUMMER15" }] }],
      }),
    );
    expect(result.invoice.lines[0]).toEqual(
      expect.objectContaining({
        netAmount: "85.00",
        allowances: [{ amount: "15.00", reason: "SUMMER15" }],
      }),
    );
    expect(result.invoice.totals.sumOfLineNetAmounts).toBe("85.00");
    expect(result.invoice.totals.totalVatAmount).toBe("16.15");
  });

  it("in a mixed-rate basket, a discount on the 7% line reduces only the 7% base — no apportioning needed", () => {
    const result = buildInvoice(
      domesticInput({
        lines: [WIDGET, { ...BOOK, allowances: [{ amount: "10.00", reason: "BOOKS10" }] }],
      }),
    );
    const byRate = Object.fromEntries(
      result.invoice.vatBreakdown.map((g) => [g.rate, g.taxableAmount]),
    );
    expect(byRate).toEqual({ "19": "100.00", "7": "30.00" });
    expect(result.warnings.map((w) => w.code)).not.toContain("shipping-discount-rate-assumption");
  });

  it("refuses a line discount larger than the line itself", () => {
    expect(() =>
      buildInvoice(
        domesticInput({ lines: [{ ...BOOK, allowances: [{ amount: "40.01", reason: "X" }] }] }),
      ),
    ).toThrow(LineAllowanceExceedsLineAmountError);
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
        expect.objectContaining({
          name: "TaxRuleError",
          ruleId: "tax-semantics#4",
          code: "EXPORT_DELIVERED_IN_EU",
        }),
      );
    }
  });
});

describe("buildInvoice — special VAT territories are refused, not invoiced by their country code (T-195)", () => {
  const B2B_EU = {
    sellerCountry: "DE",
    sellerVatId: "DE123456789",
    buyerIsBusiness: true,
    ossRegistered: false,
  } as const;
  const refusal = expect.objectContaining({
    name: "TaxRuleError",
    code: "SPECIAL_VAT_TERRITORY",
    ruleId: "tax-semantics#special-territories",
  });

  it("goods to the Canary Islands — an export, not an intra-EU supply — are refused before any category", () => {
    const input = domesticInput({
      buyer: {
        name: "Ejemplo SL",
        countryCode: "ES",
        city: "Las Palmas de Gran Canaria",
        postCode: "35001",
        vatIdentifier: "ESB12345678",
      },
      delivery: {
        actualDeliveryDate: "2026-09-10",
        deliverToCountryCode: "ES",
        deliverToPostCode: "35001",
      },
      taxContext: { ...B2B_EU, buyerCountry: "ES", buyerVatId: "ESB12345678", supplyType: "goods" },
    });
    const evidence = { vatId: "ESB12345678", status: "valid" as const, checkedAt: "2026-09-10" };
    expect(() => buildInvoice(input, { vatIdEvidence: evidence })).toThrow(refusal);
    expect(() => buildInvoice(input, { vatIdEvidence: evidence })).toThrow(/the Canary Islands/);
  });

  it("goods to Northern Ireland (GB, BT…) — an intra-EU supply for goods, not an export — are refused", () => {
    const input = domesticInput({
      buyer: { name: "Example Ltd", countryCode: "GB", city: "Belfast", postCode: "BT1 1AA" },
      taxContext: { ...B2B_EU, buyerCountry: "GB", supplyType: "goods" },
    });
    expect(() => buildInvoice(input)).toThrow(refusal);
  });

  it("a service to a business in Northern Ireland is a UK service — the territory check lets it through to row 13", () => {
    const input = domesticInput({
      buyer: { name: "Example Ltd", countryCode: "GB", city: "Belfast", postCode: "BT1 1AA" },
      taxContext: { ...B2B_EU, buyerCountry: "GB", supplyType: "services" },
    });
    expect(() => buildInvoice(input)).toThrow(
      expect.objectContaining({ code: "NON_EU_SERVICE_UNSUPPORTED" }),
    );
  });

  it("a German order delivered to Heligoland leaves the German VAT area (§1 Abs. 2 UStG) — refused, not 19 %", () => {
    const input = domesticInput({
      delivery: {
        deliverToCountryCode: "DE",
        deliverToCity: "Helgoland",
        deliverToPostCode: "27498",
      },
    });
    expect(() => buildInvoice(input)).toThrow(refusal);
  });

  it("goods are placed where they go: a buyer billed in the Canary Islands, goods delivered to Madrid", () => {
    const input = domesticInput({
      buyer: {
        name: "Ejemplo SL",
        countryCode: "ES",
        city: "Santa Cruz de Tenerife",
        postCode: "38001",
        vatIdentifier: "ESB12345678",
      },
      delivery: {
        actualDeliveryDate: "2026-09-10",
        deliverToCountryCode: "ES",
        deliverToPostCode: "28001",
      },
      taxContext: { ...B2B_EU, buyerCountry: "ES", buyerVatId: "ESB12345678", supplyType: "goods" },
    });
    const evidence = { vatId: "ESB12345678", status: "valid" as const, checkedAt: "2026-09-10" };
    expect(
      buildInvoice(input, { vatIdEvidence: evidence }).invoice.vatBreakdown[0]?.categoryCode,
    ).toBe("K");
  });

  it("a service is placed where its buyer is: a business in the Canary Islands is refused", () => {
    const input = domesticInput({
      buyer: {
        name: "Ejemplo SL",
        countryCode: "ES",
        city: "Las Palmas de Gran Canaria",
        postCode: "35001",
        vatIdentifier: "ESB12345678",
      },
      taxContext: {
        ...B2B_EU,
        buyerCountry: "ES",
        buyerVatId: "ESB12345678",
        supplyType: "services",
        regimeOverride: { kind: "reverse-charge-cross-border" },
      },
    });
    expect(() => buildInvoice(input)).toThrow(refusal);
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

describe("buildInvoice — Leitweg-ID, declared and validated (T-062, P-54)", () => {
  it("writes a valid declared Leitweg-ID to BT-10", () => {
    const input = domesticInput({ references: { leitwegId: "991-ABC-29" } });
    const result = buildInvoice(input);
    expect(result.invoice.buyerReference).toBe("991-ABC-29");
  });

  it("rejects a declared Leitweg-ID with a wrong check digit", () => {
    const input = domesticInput({ references: { leitwegId: "991-ABD-29" } });
    expect(() => buildInvoice(input)).toThrow(InvalidLeitwegIdError);
  });

  it("never reads an ordinary buyer reference as a Leitweg-ID, whatever its shape", () => {
    // "2024-01" and "4500123456-10" have a Leitweg-ID's shape but fail its check digits: an ordinary
    // reference like these was refused before the Leitweg-ID became a declared field.
    for (const buyerReference of ["Buchhaltung-2026-09", "2024-01", "4500123456-10"]) {
      const result = buildInvoice(domesticInput({ references: { buyerReference } }));
      expect(result.invoice.buyerReference).toBe(buyerReference);
    }
  });

  it("refuses a buyer reference and a Leitweg-ID together — BT-10 holds one value", () => {
    const input = domesticInput({
      references: { buyerReference: "PO-2026-4471", leitwegId: "991-ABC-29" },
    });
    expect(() => buildInvoice(input)).toThrow(DuplicateBuyerReferenceError);
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

  it("requires both parties' electronic address — KoSIT rejects a buyer without one (PEPPOL-EN16931-R010, P-43)", () => {
    const withoutBuyerAddress = domesticInput({
      buyer: {
        name: "Beispielkunde GmbH",
        countryCode: "DE",
        city: "Hamburg",
        postCode: "20095",
        electronicAddress: undefined,
        electronicAddressScheme: undefined,
      },
    });
    expect(() => buildInvoice(withoutBuyerAddress)).toThrow(
      expect.objectContaining({
        name: "MissingElectronicAddressError",
        party: "buyer",
        code: "MISSING_ELECTRONIC_ADDRESS",
      }),
    );
    const withoutSellerScheme = domesticInput({
      seller: { ...SELLER, electronicAddressScheme: undefined },
    });
    expect(() => buildInvoice(withoutSellerScheme)).toThrow(MissingElectronicAddressError);
  });

  it("requires seller.contact (BR-DE-2, unconditional — every invoice declares the XRechnung 3.0 CIUS)", () => {
    const input = domesticInput({ seller: { ...SELLER, contact: undefined } });
    expect(() => buildInvoice(input)).toThrow(MissingSellerContactError);
  });

  it("carries every address line into the invoice — BT-35/36, BT-50/51, BT-75/76 (P-60)", () => {
    const input = domesticInput({
      seller: { ...SELLER, addressLine2: "Aufgang B" },
      buyer: {
        name: "Beispielkunde GmbH",
        countryCode: "DE",
        addressLine1: "Beispielweg 2",
        addressLine2: "3. OG",
        city: "Hamburg",
        postCode: "20095",
      },
      delivery: {
        deliverToCountryCode: "DE",
        deliverToCity: "Köln",
        deliverToPostCode: "50667",
        deliverToAddressLine1: "Lagerstraße 3",
        deliverToAddressLine2: "Tor 4",
      },
    });
    const { invoice } = buildInvoice(input);
    expect(invoice.seller.addressLine1).toBe("Musterstraße 1");
    expect(invoice.seller.addressLine2).toBe("Aufgang B");
    expect(invoice.buyer.addressLine1).toBe("Beispielweg 2");
    expect(invoice.buyer.addressLine2).toBe("3. OG");
    expect(invoice.delivery?.deliverToAddressLine1).toBe("Lagerstraße 3");
    expect(invoice.delivery?.deliverToAddressLine2).toBe("Tor 4");
  });

  it("requires the seller's street — §14 Abs. 4 Nr. 1 UStG needs the seller's full address on every invoice (P-60)", () => {
    expect(() =>
      buildInvoice(domesticInput({ seller: { ...SELLER, addressLine1: undefined } })),
    ).toThrow(MissingSellerAddressError);
    expect(() =>
      buildInvoice(domesticInput({ seller: { ...SELLER, addressLine1: "  " } })),
    ).toThrow(MissingSellerAddressError);
  });

  it("warns when the buyer has no street and the invoice is above EUR 250 — below it §33 UStDV needs none (P-60)", () => {
    const buyer = {
      name: "Beispielkunde GmbH",
      countryCode: "DE" as const,
      city: "Hamburg",
      postCode: "20095",
    };
    const large = buildInvoice(
      domesticInput({
        buyer,
        lines: [
          {
            quantity: "3",
            unitCode: "C62",
            netPrice: "100.00",
            itemName: "Widget",
            taxRateKind: "standard",
          },
        ],
      }),
    );
    expect(large.warnings.map((w) => w.code)).toContain("buyer-street-missing");
    const small = buildInvoice(domesticInput({ buyer }));
    expect(small.invoice.totals.totalAmountWithVat).toBe("119.00");
    expect(small.warnings.map((w) => w.code)).not.toContain("buyer-street-missing");
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

describe("buildInvoice — VAT-inclusive prices total exactly what was charged (P-61)", () => {
  const inclusiveLine = (priceInclVat: string, quantity = "1") => ({
    quantity,
    unitCode: "C62",
    priceInclVat,
    itemName: "T-Shirt",
    taxRateKind: "standard" as const,
  });

  it("takes the VAT out of each rate group's gross total — 10.00 + 10.00 shipping is 20.00, not 19.99", () => {
    const { invoice } = buildInvoice(
      domesticInput({
        lines: [inclusiveLine("10.00")],
        shipping: { amountInclVat: "10.00", reason: "Versand" },
      }),
    );
    expect(invoice.totals.totalAmountWithVat).toBe("20.00");
    expect(invoice.totals.amountDueForPayment).toBe("20.00");
    expect(invoice.vatBreakdown).toEqual([
      expect.objectContaining({ taxableAmount: "16.81", taxAmount: "3.19", rate: "19" }),
    ]);
    expect(invoice.lines[0]?.netAmount).toBe("8.41");
    expect(invoice.lines[0]?.netPrice).toBe("8.4100");
    expect(invoice.documentLevelCharges?.[0]?.amount).toBe("8.40");
    expect(invoice.totals.totalAmountWithoutVat).toBe("16.81");
  });

  it("carries VAT-inclusive line and document discounts into the same group", () => {
    const { invoice } = buildInvoice(
      domesticInput({
        lines: [
          { ...inclusiveLine("10.00", "3"), allowances: [{ amount: "3.00", reason: "SUMMER10" }] },
        ],
        shipping: { amountInclVat: "10.00", reason: "Versand" },
        discounts: [{ amountInclVat: "2.00", reason: "Treuerabatt" }],
      }),
    );
    // 30.00 − 3.00 + 10.00 − 2.00 = 35.00 gross, 5.59 VAT, 29.41 net.
    expect(invoice.totals.totalAmountWithVat).toBe("35.00");
    expect(invoice.totals.totalVatAmount).toBe("5.59");
    const line = invoice.lines[0];
    expect(line?.allowances?.[0]?.amount).toBe("2.52");
    const lineNet = line?.netAmount ?? "";
    expect(Number(lineNet) + Number(invoice.documentLevelCharges?.[0]?.amount)).toBeCloseTo(
      Number(invoice.totals.totalAmountWithoutVat) +
        Number(invoice.documentLevelAllowances?.[0]?.amount),
      2,
    );
  });

  it("keeps each rate's own gross total when a basket mixes 7% and 19%", () => {
    const { invoice } = buildInvoice(
      domesticInput({
        lines: [inclusiveLine("11.90"), { ...inclusiveLine("10.70"), taxRateKind: "reduced" }],
      }),
    );
    expect(invoice.totals.totalAmountWithVat).toBe("22.60");
    expect(invoice.vatBreakdown).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ taxableAmount: "10.00", taxAmount: "1.90", rate: "19" }),
        expect.objectContaining({ taxableAmount: "10.00", taxAmount: "0.70", rate: "7" }),
      ]),
    );
  });

  it("refuses a line or charge that gives both a net and a VAT-inclusive amount, or neither", () => {
    expect(() =>
      buildInvoice(domesticInput({ lines: [{ ...inclusiveLine("10.00"), netPrice: "8.40" }] })),
    ).toThrow(InvalidPriceBasisError);
    expect(() =>
      buildInvoice(
        domesticInput({
          lines: [{ quantity: "1", unitCode: "C62", itemName: "T-Shirt", taxRateKind: "standard" }],
        }),
      ),
    ).toThrow(InvalidPriceBasisError);
    expect(() =>
      buildInvoice(domesticInput({ shipping: { amount: "8.40", amountInclVat: "10.00" } })),
    ).toThrow(InvalidPriceBasisError);
  });
});
