import { describe, expect, it } from "vitest";
import { selectProfile, UnsupportedCountryError } from "./profile.js";

describe("selectProfile", () => {
  describe("branch 1: DE buyer with a declared Leitweg-ID", () => {
    it("resolves XRECHNUNG regardless of preferredProfile", () => {
      expect(selectProfile({ buyerCountry: "DE", leitwegId: "991-ABC-29" })).toBe("XRECHNUNG");
      expect(
        selectProfile({
          buyerCountry: "DE",
          leitwegId: "991-ABC-29",
          preferredProfile: "EN16931",
        }),
      ).toBe("XRECHNUNG");
    });
  });

  describe("branch 2: DE buyer without a Leitweg-ID", () => {
    it("falls back to preferredProfile when there is no Leitweg-ID", () => {
      expect(selectProfile({ buyerCountry: "DE", preferredProfile: "XRECHNUNG" })).toBe(
        "XRECHNUNG",
      );
    });

    it("defaults to EN16931 when there is no Leitweg-ID and no preferredProfile", () => {
      expect(selectProfile({ buyerCountry: "DE" })).toBe("EN16931");
    });
  });

  describe("branch 3: other EU/EEA buyer, or Switzerland/UK", () => {
    it("resolves EN16931 for another EU member state", () => {
      expect(selectProfile({ buyerCountry: "FR" })).toBe("EN16931");
      expect(selectProfile({ buyerCountry: "NL" })).toBe("EN16931");
    });

    it("resolves EN16931 for an EEA member that isn't also an EU member", () => {
      expect(selectProfile({ buyerCountry: "NO" })).toBe("EN16931");
    });

    it("resolves EN16931 for Switzerland and the UK", () => {
      expect(selectProfile({ buyerCountry: "CH" })).toBe("EN16931");
      expect(selectProfile({ buyerCountry: "GB" })).toBe("EN16931");
    });

    it("honors preferredProfile", () => {
      expect(selectProfile({ buyerCountry: "FR", preferredProfile: "XRECHNUNG" })).toBe(
        "XRECHNUNG",
      );
    });

    it("ignores a Leitweg-ID — B2G is a Germany-only signal", () => {
      expect(selectProfile({ buyerCountry: "FR", leitwegId: "991-ABC-29" })).toBe("EN16931");
    });
  });

  describe("branch 4: clearance-model country (Italy, Poland)", () => {
    it("throws UnsupportedCountryError naming the clearance reason, for Italy", () => {
      expect(() => selectProfile({ buyerCountry: "IT" })).toThrow(UnsupportedCountryError);
      try {
        selectProfile({ buyerCountry: "IT" });
        expect.unreachable();
      } catch (error) {
        expect(error).toBeInstanceOf(UnsupportedCountryError);
        expect((error as UnsupportedCountryError).countryCode).toBe("IT");
        expect((error as UnsupportedCountryError).reason).toBe("clearance-model");
        expect((error as UnsupportedCountryError).code).toBe("UNSUPPORTED_BUYER_COUNTRY_CLEARANCE");
        expect((error as Error).message).toContain("national platform");
      }
    });

    it("throws UnsupportedCountryError naming the clearance reason, for Poland", () => {
      try {
        selectProfile({ buyerCountry: "PL" });
        expect.unreachable();
      } catch (error) {
        expect(error).toBeInstanceOf(UnsupportedCountryError);
        expect((error as UnsupportedCountryError).countryCode).toBe("PL");
        expect((error as UnsupportedCountryError).reason).toBe("clearance-model");
        expect((error as UnsupportedCountryError).code).toBe("UNSUPPORTED_BUYER_COUNTRY_CLEARANCE");
        expect((error as Error).message).toContain("national platform");
      }
    });
  });

  describe("branch 5: everything else (not DE, not EU/EEA/CH/UK, not a clearance country)", () => {
    it("throws UnsupportedCountryError with the generic not-yet-supported message", () => {
      expect(() => selectProfile({ buyerCountry: "US" })).toThrow(UnsupportedCountryError);
      expect(() => selectProfile({ buyerCountry: "US" })).toThrow(
        expect.objectContaining({ code: "UNSUPPORTED_BUYER_COUNTRY" }),
      );
      try {
        selectProfile({ buyerCountry: "US" });
        expect.unreachable();
      } catch (error) {
        expect(error).toBeInstanceOf(UnsupportedCountryError);
        expect((error as UnsupportedCountryError).countryCode).toBe("US");
        expect((error as UnsupportedCountryError).reason).toBe("not-yet-supported");
        expect((error as Error).message).toContain('Buyer country "US" is not yet supported');
      }
    });
  });

  // T-208: the message reaches the merchant as it is ("Not issued: …" in the admin) — no function name.
  it.each(["IT", "US"] as const)(
    "starts the refusal for %s with the buyer's country, not a function name",
    (buyerCountry) => {
      expect(() => selectProfile({ buyerCountry })).toThrow(
        new RegExp(`^Buyer country "${buyerCountry}" `),
      );
    },
  );
});
