import { describe, expect, it } from "vitest";
import { computeLeitwegIdCheckDigits, validateLeitwegId } from "./leitweg-id.js";

describe("validateLeitwegId — against the real KoSIT Format-Spezifikation v2.0.2", () => {
  it("the spec's own §2.4 worked example (numeric-only)", () => {
    expect(validateLeitwegId("04011000-1234512345-06")).toEqual({ valid: true });
    expect(computeLeitwegIdCheckDigits("04011000", "1234512345")).toBe("06");
  });

  // The following three are cross-checked against a real, independent third-party validator
  // (https://consult-sk.com/en/e-invoicing-tools/leitweg-id-checker/, "according to the KoSIT 2.0.2
  // specification") via the Browser tool — not just self-consistency between this file's generator and
  // validator, which could share the same bug.
  it("a real example with letters in Feinadressierung (A-Z -> 10-35 substitution)", () => {
    expect(validateLeitwegId("991-ABC-29")).toEqual({ valid: true });
    expect(computeLeitwegIdCheckDigits("991", "ABC")).toBe("29");
  });

  it("the minimal 5-character form (no Feinadressierung at all)", () => {
    expect(validateLeitwegId("04-86")).toEqual({ valid: true });
  });

  it("a correct shape with a wrong check digit is rejected (not just malformed)", () => {
    const result = validateLeitwegId("991-ABD-29"); // one letter changed from the valid 991-ABC-29
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("checksum failed");
  });

  it("rejects a structurally malformed value with a clear reason, not a checksum verdict", () => {
    expect(validateLeitwegId("not-a-leitweg-id").reason).toContain(
      "does not match the Leitweg-ID shape",
    );
    expect(validateLeitwegId("1-AB-06").reason).toContain("does not match the Leitweg-ID shape"); // Grobadressierung too short (1 digit, min 2)
    expect(validateLeitwegId("04011000-1234512345").reason).toContain(
      "does not match the Leitweg-ID shape",
    ); // missing Prüfziffer
  });

  it("case-insensitivity of Feinadressierung letters (spec §2.3: 'nicht case-sensitiv')", () => {
    expect(validateLeitwegId("991-abc-29")).toEqual({ valid: true });
  });
});
