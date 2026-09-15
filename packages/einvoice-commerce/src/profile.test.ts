import { describe, expect, it } from "vitest";
import { selectProfile, UnsupportedCountryError } from "./profile.js";

describe("selectProfile", () => {
  it("throws UnsupportedCountryError for any buyer country other than DE (v0.1 scope)", () => {
    expect(() => selectProfile({ buyerCountry: "FR" })).toThrow(UnsupportedCountryError);
    try {
      selectProfile({ buyerCountry: "FR" });
    } catch (error) {
      expect(error).toBeInstanceOf(UnsupportedCountryError);
      expect((error as UnsupportedCountryError).countryCode).toBe("FR");
      expect((error as Error).message).toMatch(/FR/);
    }
  });

  it("resolves XRECHNUNG whenever a buyerReference is present, regardless of preferredProfile", () => {
    expect(selectProfile({ buyerCountry: "DE", buyerReference: "991-12345-67" })).toBe("XRECHNUNG");
    expect(
      selectProfile({
        buyerCountry: "DE",
        buyerReference: "991-12345-67",
        preferredProfile: "EN16931",
      }),
    ).toBe("XRECHNUNG");
  });

  it("falls back to preferredProfile when there is no buyerReference", () => {
    expect(selectProfile({ buyerCountry: "DE", preferredProfile: "XRECHNUNG" })).toBe("XRECHNUNG");
  });

  it("defaults to EN16931 when there is no buyerReference and no preferredProfile", () => {
    expect(selectProfile({ buyerCountry: "DE" })).toBe("EN16931");
  });
});
