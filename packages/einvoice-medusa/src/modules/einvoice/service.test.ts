import { describe, expect, it } from "vitest";
import EinvoiceModuleService, { InvalidEinvoiceModuleOptionsError } from "./service.js";

const VALID_SELLER = {
  name: "Musterfirma GmbH",
  countryCode: "DE" as const,
  city: "Berlin",
  postCode: "10115",
  vatIdentifier: "DE123456789",
  electronicAddress: "invoicing@musterfirma.example",
  electronicAddressScheme: "EM" as const,
};

const VALID_PAYMENT = { means: "58" as const, iban: "DE89370400440532013000" };

// `MedusaService(...)`'s generated base constructor only reads `container.baseRepository` at construction
// time (per-model repositories, e.g. for `createEinvoiceDocuments`, are resolved lazily inside each CRUD
// method itself, not eagerly here) — a minimal fake is enough for these constructor-validation tests,
// none of which call a method that touches the database.
const FAKE_CONTAINER = { baseRepository: { transaction: async () => undefined } };

describe("EinvoiceModuleService", () => {
  it("holds validated options unchanged", () => {
    const options = {
      seller: VALID_SELLER,
      payment: VALID_PAYMENT,
      defaultProfile: "EN16931" as const,
    };
    const service = new EinvoiceModuleService(FAKE_CONTAINER, options);
    expect(service.options).toBe(options);
  });

  it("accepts options without defaultProfile (selectProfile has its own default)", () => {
    const service = new EinvoiceModuleService(FAKE_CONTAINER, {
      seller: VALID_SELLER,
      payment: VALID_PAYMENT,
    });
    expect(service.options.defaultProfile).toBeUndefined();
  });

  it("rejects a missing seller", () => {
    expect(
      () =>
        new EinvoiceModuleService(FAKE_CONTAINER, {
          seller: undefined as never,
          payment: VALID_PAYMENT,
        }),
    ).toThrow(InvalidEinvoiceModuleOptionsError);
  });

  it("rejects a seller with an empty name", () => {
    expect(
      () =>
        new EinvoiceModuleService(FAKE_CONTAINER, {
          seller: { ...VALID_SELLER, name: "" },
          payment: VALID_PAYMENT,
        }),
    ).toThrow(InvalidEinvoiceModuleOptionsError);
  });

  it("rejects a seller missing vatIdentifier, even though CommerceParty leaves it optional for a buyer", () => {
    const sellerWithoutVatId: Record<string, unknown> = { ...VALID_SELLER };
    delete sellerWithoutVatId.vatIdentifier;
    expect(
      () =>
        new EinvoiceModuleService(FAKE_CONTAINER, {
          seller: sellerWithoutVatId as typeof VALID_SELLER,
          payment: VALID_PAYMENT,
        }),
    ).toThrow(/vatIdentifier/);
  });

  it("rejects a seller missing electronicAddress/electronicAddressScheme (BR-62, found by a real KoSIT rejection)", () => {
    const sellerWithoutAddress: Record<string, unknown> = { ...VALID_SELLER };
    delete sellerWithoutAddress.electronicAddress;
    delete sellerWithoutAddress.electronicAddressScheme;
    expect(
      () =>
        new EinvoiceModuleService(FAKE_CONTAINER, {
          seller: sellerWithoutAddress as typeof VALID_SELLER,
          payment: VALID_PAYMENT,
        }),
    ).toThrow(/electronicAddress/);
  });

  it("rejects options missing payment.means (BR-DE-1, found by a real KoSIT rejection)", () => {
    expect(
      () =>
        new EinvoiceModuleService(FAKE_CONTAINER, {
          seller: VALID_SELLER,
          payment: undefined as never,
        }),
    ).toThrow(/payment/);
  });
});
