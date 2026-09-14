import { describe, expect, it } from "vitest";
import { MapVatIdVerifier, StaticVatIdVerifier } from "./vat-id-verifier.js";

const NOW = new Date("2026-09-14T12:00:00.000Z");

describe("StaticVatIdVerifier — the three real VIES outcomes (D-19 acceptance)", () => {
  it("valid", async () => {
    const evidence = await new StaticVatIdVerifier("valid", "CONSULT-1").verify(
      "FR12345678901",
      NOW,
    );
    expect(evidence).toEqual({
      vatId: "FR12345678901",
      status: "valid",
      checkedAt: "2026-09-14",
      consultationNumber: "CONSULT-1",
    });
  });

  it("invalid", async () => {
    const evidence = await new StaticVatIdVerifier("invalid", "CONSULT-2").verify(
      "FR00000000000",
      NOW,
    );
    expect(evidence.status).toBe("invalid");
    expect(evidence.consultationNumber).toBe("CONSULT-2");
  });

  it("unavailable — never carries a consultation number, even if one was configured", async () => {
    const evidence = await new StaticVatIdVerifier("unavailable", "CONSULT-3").verify(
      "FR12345678901",
      NOW,
    );
    expect(evidence.status).toBe("unavailable");
    expect(evidence.consultationNumber).toBeUndefined();
  });
});

describe("MapVatIdVerifier", () => {
  it("returns the scripted status per VAT-ID", async () => {
    const verifier = new MapVatIdVerifier(
      new Map([
        ["FR12345678901", "valid"],
        ["FR00000000000", "invalid"],
      ]),
    );
    expect((await verifier.verify("FR12345678901", NOW)).status).toBe("valid");
    expect((await verifier.verify("FR00000000000", NOW)).status).toBe("invalid");
  });

  it("throws for an unscripted VAT-ID rather than defaulting silently", async () => {
    const verifier = new MapVatIdVerifier(new Map());
    await expect(verifier.verify("FR99999999999", NOW)).rejects.toThrow(/no scripted response/);
  });
});
