/**
 * T-061/W9: one test per row of `docs/tax-semantics.md` — the table's own
 * stated design ("одна строка — один тест — один TaxDecision",
 * plan-v0.1 §4.4). Expected values are copied from the real, already-
 * KoSIT-validated fixtures that encode the same scenarios
 * (`fixtures/de-*), not re-derived — this is what "one row = one test"
 * is supposed to prove: this package's own reasoning lands on the exact
 * category/rate/exemption those independently-verified fixtures already
 * use.
 */
import { describe, expect, it } from "vitest";
import {
  DE_REDUCED_RATE,
  DE_STANDARD_RATE,
  TaxRuleError,
  decideVatCategory,
  resolveLineRate,
} from "./tax-rules.js";
import type { TaxContext, VatIdEvidence } from "./types.js";

const BASE: TaxContext = {
  sellerCountry: "DE",
  sellerVatId: "DE123456789",
  buyerCountry: "DE",
  buyerIsBusiness: true,
  ossRegistered: false,
  supplyType: "goods",
};

describe("decideVatCategory — docs/tax-semantics.md, row by row", () => {
  it("row 1: DE → DE B2B, standard rate → S, 19%", () => {
    const decision = decideVatCategory(BASE);
    expect(decision.categoryCode).toBe("S");
    expect(decision.ruleId).toBe("tax-semantics#1");
    expect(resolveLineRate(decision, BASE, "standard")).toBe(DE_STANDARD_RATE);
    expect(DE_STANDARD_RATE).toBe("19");
  });

  it("row 2: DE → DE B2B, reduced rate → S, 7% (same category as row 1, different per-line rate)", () => {
    const decision = decideVatCategory(BASE);
    expect(decision.categoryCode).toBe("S");
    expect(resolveLineRate(decision, BASE, "reduced")).toBe(DE_REDUCED_RATE);
    expect(DE_REDUCED_RATE).toBe("7");
  });

  it("row 3: DE → FR B2B, VAT-ID verified valid by VIES → K, VATEX-EU-IC", () => {
    const context: TaxContext = { ...BASE, buyerCountry: "FR", buyerVatId: "FR12345678901" };
    const evidence: VatIdEvidence = {
      vatId: "FR12345678901",
      status: "valid",
      checkedAt: "2026-09-14",
      consultationNumber: "ABC123",
    };
    const decision = decideVatCategory(context, evidence);
    expect(decision).toEqual({
      ruleId: "tax-semantics#3",
      categoryCode: "K",
      exemptionReasonCode: "VATEX-EU-IC",
      exemptionReasonText:
        "Innergemeinschaftliche Lieferung (§4 Nr. 1b, §6a UStG) / Intra-Community supply",
      reasoning: expect.stringContaining("FR12345678901"),
    });
    expect(resolveLineRate(decision, context, undefined)).toBe("0");
  });

  it("row 3 (D-19 gate): K is refused without a positive VIES check or an explicit override", () => {
    const context: TaxContext = { ...BASE, buyerCountry: "FR", buyerVatId: "FR12345678901" };
    expect(() => decideVatCategory(context)).toThrow(TaxRuleError);
    expect(() =>
      decideVatCategory(context, {
        vatId: "FR12345678901",
        status: "invalid",
        checkedAt: "2026-09-14",
      }),
    ).toThrow(TaxRuleError);
    expect(() =>
      decideVatCategory(context, {
        vatId: "FR12345678901",
        status: "unavailable",
        checkedAt: "2026-09-14",
      }),
    ).toThrow(TaxRuleError);
  });

  it("row 3 (D-19 override path): K selected via an explicit manual-confirmation override when VIES is unavailable", () => {
    const context: TaxContext = {
      ...BASE,
      buyerCountry: "FR",
      buyerVatId: "FR12345678901",
      regimeOverride: {
        kind: "intra-eu-confirmed",
        evidenceNote: "confirmed by phone with buyer's accountant",
      },
    };
    const decision = decideVatCategory(context, {
      vatId: "FR12345678901",
      status: "unavailable",
      checkedAt: "2026-09-14",
    });
    expect(decision.categoryCode).toBe("K");
    expect(decision.reasoning).toContain("confirmed by phone");
  });

  it("row 4: DE → CH (non-EU) → G, VATEX-EU-G", () => {
    const context: TaxContext = { ...BASE, buyerCountry: "CH" };
    const decision = decideVatCategory(context);
    expect(decision).toEqual({
      ruleId: "tax-semantics#4",
      categoryCode: "G",
      exemptionReasonCode: "VATEX-EU-G",
      exemptionReasonText: "Ausfuhrlieferung (§4 Nr. 1a, §6 UStG) / Export outside the EU",
      reasoning: expect.stringContaining("CH"),
    });
  });

  it("row 5: DE → DE B2B reverse-charge service (explicit override) → AE, VATEX-EU-AE", () => {
    const context: TaxContext = { ...BASE, regimeOverride: { kind: "reverse-charge" } };
    const decision = decideVatCategory(context);
    expect(decision).toEqual({
      ruleId: "tax-semantics#5",
      categoryCode: "AE",
      exemptionReasonCode: "VATEX-EU-AE",
      exemptionReasonText:
        "Steuerschuldnerschaft des Leistungsempfängers (§13b UStG) / Reverse charge",
      reasoning: expect.any(String),
    });
    expect(resolveLineRate(decision, context, undefined)).toBe("0");
  });

  it("row 5 refuses a reverse-charge override on a non-domestic-B2B transaction", () => {
    const context: TaxContext = {
      ...BASE,
      buyerCountry: "FR",
      regimeOverride: { kind: "reverse-charge" },
    };
    expect(() => decideVatCategory(context)).toThrow(TaxRuleError);
  });

  it("row 6: DE domestic exempt supply (explicit override, mandatory reason text) → E", () => {
    const context: TaxContext = {
      ...BASE,
      regimeOverride: {
        kind: "exempt",
        reasonText: "Steuerfreie Heilbehandlung gemäß §4 Nr. 14 UStG",
      },
    };
    const decision = decideVatCategory(context);
    expect(decision.categoryCode).toBe("E");
    expect(decision.exemptionReasonText).toBe("Steuerfreie Heilbehandlung gemäß §4 Nr. 14 UStG");
    expect(decision.exemptionReasonCode).toBeUndefined();
  });

  it("row 7: DE → EU B2C distance sale under OSS → S at the buyer country's own rate", () => {
    const context: TaxContext = {
      ...BASE,
      buyerCountry: "FR",
      buyerIsBusiness: false,
      ossRegistered: true,
      ossRateOverride: "20",
    };
    const decision = decideVatCategory(context);
    expect(decision.categoryCode).toBe("S");
    expect(decision.ruleId).toBe("tax-semantics#7");
    expect(resolveLineRate(decision, context, undefined)).toBe("20");
  });

  it("row 7 refuses OSS without an explicit rate — no built-in EU rate table", () => {
    const context: TaxContext = {
      ...BASE,
      buyerCountry: "FR",
      buyerIsBusiness: false,
      ossRegistered: true,
    };
    expect(() => decideVatCategory(context)).toThrow(TaxRuleError);
  });

  it("row 8: zero-rated domestic supply (explicit override) → Z, no exemption text (BR-Z-10)", () => {
    const context: TaxContext = { ...BASE, regimeOverride: { kind: "zero-rated" } };
    const decision = decideVatCategory(context);
    expect(decision.categoryCode).toBe("Z");
    expect(decision.exemptionReasonCode).toBeUndefined();
    expect(decision.exemptionReasonText).toBeUndefined();
  });

  it("row 9 (mixed rates) is not a distinct regime: two S lines can independently resolve to 19% and 7%", () => {
    const decision = decideVatCategory(BASE);
    expect(resolveLineRate(decision, BASE, "standard")).toBe("19");
    expect(resolveLineRate(decision, BASE, "reduced")).toBe("7");
  });

  it("a domestic S line without taxRateKind refuses to guess a rate", () => {
    const decision = decideVatCategory(BASE);
    expect(() => resolveLineRate(decision, BASE, undefined)).toThrow(TaxRuleError);
  });

  it("refuses a seller outside v0.1 scope (Germany only)", () => {
    const context: TaxContext = { ...BASE, sellerCountry: "FR", sellerVatId: "FR12345678901" };
    expect(() => decideVatCategory(context)).toThrow(TaxRuleError);
  });
});
