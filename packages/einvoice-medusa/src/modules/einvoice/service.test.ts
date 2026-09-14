import { describe, expect, it } from "vitest";
import EinvoiceModuleService, { InvalidEinvoiceModuleOptionsError } from "./service.js";

const VALID_SELLER = {
  name: "Musterfirma GmbH",
  countryCode: "DE" as const,
  city: "Berlin",
  postCode: "10115",
  vatIdentifier: "DE123456789",
};

describe("EinvoiceModuleService", () => {
  it("holds validated options unchanged", () => {
    const options = { seller: VALID_SELLER, defaultProfile: "EN16931" as const };
    const service = new EinvoiceModuleService({}, options);
    expect(service.options).toBe(options);
  });

  it("accepts options without defaultProfile (selectProfile has its own default)", () => {
    const service = new EinvoiceModuleService({}, { seller: VALID_SELLER });
    expect(service.options.defaultProfile).toBeUndefined();
  });

  it("rejects a missing seller", () => {
    expect(() => new EinvoiceModuleService({}, { seller: undefined as never })).toThrow(
      InvalidEinvoiceModuleOptionsError,
    );
  });

  it("rejects a seller with an empty name", () => {
    expect(() => new EinvoiceModuleService({}, { seller: { ...VALID_SELLER, name: "" } })).toThrow(
      InvalidEinvoiceModuleOptionsError,
    );
  });

  it("rejects a seller missing vatIdentifier, even though CommerceParty leaves it optional for a buyer", () => {
    const sellerWithoutVatId: Record<string, unknown> = { ...VALID_SELLER };
    delete sellerWithoutVatId.vatIdentifier;
    expect(
      () => new EinvoiceModuleService({}, { seller: sellerWithoutVatId as typeof VALID_SELLER }),
    ).toThrow(/vatIdentifier/);
  });
});
