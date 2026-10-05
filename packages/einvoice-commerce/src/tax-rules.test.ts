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
  MixedSupplyCrossBorderError,
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
      scope: { kind: "document" },
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

  it("row 3 (P-44): K refuses VIES evidence that was issued for a different VAT-ID than the buyer's", () => {
    const context: TaxContext = { ...BASE, buyerCountry: "FR", buyerVatId: "FR12345678901" };
    expect(() =>
      decideVatCategory(context, {
        vatId: "IT12345678901",
        status: "valid",
        checkedAt: "2026-09-14",
      }),
    ).toThrow(expect.objectContaining({ name: "TaxRuleError", ruleId: "tax-semantics#3" }));
    // Formatting differences are not a different number.
    expect(
      decideVatCategory(context, {
        vatId: "fr 123 456 789 01",
        status: "valid",
        checkedAt: "2026-09-14",
      }).categoryCode,
    ).toBe("K");
  });

  it("row 3 (P-44): K refuses a buyer VAT-ID issued by Germany itself (§6a Abs. 1 Nr. 4 UStG)", () => {
    const context: TaxContext = { ...BASE, buyerCountry: "FR", buyerVatId: "DE987654321" };
    expect(() =>
      decideVatCategory(context, {
        vatId: "DE987654321",
        status: "valid",
        checkedAt: "2026-09-14",
      }),
    ).toThrow(expect.objectContaining({ name: "TaxRuleError", ruleId: "tax-semantics#3" }));
    expect(() =>
      decideVatCategory({
        ...context,
        regimeOverride: { kind: "intra-eu-confirmed", evidenceNote: "phone" },
      }),
    ).toThrow(expect.objectContaining({ name: "TaxRuleError", ruleId: "tax-semantics#3" }));
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
      scope: { kind: "document" },
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
      scope: { kind: "document" },
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

  it("row 7 (P-46): OSS refuses a rate of zero or one that is not a number", () => {
    const context: TaxContext = {
      ...BASE,
      buyerCountry: "FR",
      buyerIsBusiness: false,
      ossRegistered: true,
    };
    for (const ossRateOverride of ["0", "0.00", "twenty"]) {
      expect(() => decideVatCategory({ ...context, ossRateOverride })).toThrow(
        expect.objectContaining({ name: "TaxRuleError", ruleId: "tax-semantics#7" }),
      );
    }
  });

  it("row 7 (P-46): OSS refuses services — only §3a Abs. 5 UStG services move to the consumer's country", () => {
    const context: TaxContext = {
      ...BASE,
      buyerCountry: "FR",
      buyerIsBusiness: false,
      ossRegistered: true,
      ossRateOverride: "20",
      supplyType: "services",
    };
    expect(() => decideVatCategory(context)).toThrow(/§3a Abs\. 5 UStG/);
  });

  it("row 7 (P-46): OSS refuses a reduced-rate line and a line charged at another rate than the declared one", () => {
    const context: TaxContext = {
      ...BASE,
      buyerCountry: "FR",
      buyerIsBusiness: false,
      ossRegistered: true,
      ossRateOverride: "20",
    };
    const decision = decideVatCategory(context);
    expect(() => resolveLineRate(decision, context, "reduced")).toThrow(/reduced-rate line/);
    expect(() => resolveLineRate(decision, context, undefined, "5.5")).toThrow(/charged 5\.5%/);
    expect(resolveLineRate(decision, context, "standard", "20.00")).toBe("20");
  });

  it("row 8: zero-rated domestic supply (explicit override) → Z, no exemption text (BR-Z-10)", () => {
    const context: TaxContext = { ...BASE, regimeOverride: { kind: "zero-rated" } };
    const decision = decideVatCategory(context);
    expect(decision.categoryCode).toBe("Z");
    expect(decision.exemptionReasonCode).toBeUndefined();
    expect(decision.exemptionReasonText).toBeUndefined();
  });

  it("rows 6/8 (P-45): the exempt and zero-rated overrides refuse outside a domestic supply", () => {
    const frGoods: TaxContext = { ...BASE, buyerCountry: "FR", buyerVatId: "FR12345678901" };
    const frService: TaxContext = { ...frGoods, supplyType: "services" };
    const usService: TaxContext = { ...BASE, buyerCountry: "US", supplyType: "services" };
    const exempt = { kind: "exempt", reasonText: "Steuerfrei nach §4 Nr. 21 UStG" } as const;

    for (const context of [frGoods, frService, usService]) {
      expect(() =>
        decideVatCategory({ ...context, regimeOverride: { kind: "zero-rated" } }),
      ).toThrow(expect.objectContaining({ name: "TaxRuleError", ruleId: "tax-semantics#8" }));
      expect(() => decideVatCategory({ ...context, regimeOverride: exempt })).toThrow(
        expect.objectContaining({ name: "TaxRuleError", ruleId: "tax-semantics#6" }),
      );
    }
    // A consumer operator of a photovoltaic installation is inside §12 Abs. 3 UStG — the boundary is the
    // place of supply, not whether the buyer is a business.
    expect(
      decideVatCategory({ ...BASE, buyerIsBusiness: false, regimeOverride: { kind: "zero-rated" } })
        .categoryCode,
    ).toBe("Z");
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

  it("a domestic S line takes its rate kind from the rate it was charged, and refuses any other rate (P-50)", () => {
    const decision = decideVatCategory(BASE);
    expect(resolveLineRate(decision, BASE, undefined, "19")).toBe("19");
    expect(resolveLineRate(decision, BASE, undefined, "7.0")).toBe("7");
    expect(resolveLineRate(decision, BASE, "reduced", "7")).toBe("7");
    // A line charged 0% was invoiced at 7% before: the adapter snapped the rate to the nearer German one.
    expect(() => resolveLineRate(decision, BASE, undefined, "0")).toThrow(/charged 0% VAT/);
    expect(() => resolveLineRate(decision, BASE, undefined, "16")).toThrow(/charged 16% VAT/);
    expect(() => resolveLineRate(decision, BASE, "standard", "7")).toThrow(
      /classified as standard/,
    );
    expect(() => resolveLineRate(decision, BASE, undefined, "19%")).toThrow(/not a VAT rate/);
  });

  it("the charged rate is not consulted for a category that is uniform for the whole document", () => {
    const context: TaxContext = { ...BASE, regimeOverride: { kind: "zero-rated" } };
    expect(resolveLineRate(decideVatCategory(context), context, undefined, "19")).toBe("0");
  });

  it("refuses a seller outside v0.1 scope (Germany only)", () => {
    const context: TaxContext = { ...BASE, sellerCountry: "FR", sellerVatId: "FR12345678901" };
    expect(() => decideVatCategory(context)).toThrow(TaxRuleError);
  });

  it("row 12: DE → EU B2B service refuses pending M-006, even with a positive VIES check (settled category, no artifact)", () => {
    const context: TaxContext = {
      ...BASE,
      buyerCountry: "FR",
      buyerVatId: "FR12345678901",
      supplyType: "services",
    };
    const evidence: VatIdEvidence = {
      vatId: "FR12345678901",
      status: "valid",
      checkedAt: "2026-09-14",
      consultationNumber: "ABC123",
    };
    expect(() => decideVatCategory(context, evidence)).toThrow(TaxRuleError);
    // The refusal names the way out — declaring the fact — not an internal planning reference.
    expect(() => decideVatCategory(context, evidence)).toThrow(/reverse-charge-cross-border/);
  });

  it("row 12 (T-135/P-34): DE → EU B2B service via explicit cross-border reverse-charge override → AE, VATEX-EU-AE", () => {
    const context: TaxContext = {
      ...BASE,
      buyerCountry: "FR",
      supplyType: "services",
      regimeOverride: { kind: "reverse-charge-cross-border" },
    };
    const decision = decideVatCategory(context);
    expect(decision).toEqual({
      ruleId: "tax-semantics#12",
      categoryCode: "AE",
      exemptionReasonCode: "VATEX-EU-AE",
      exemptionReasonText: expect.stringContaining("Reverse charge"),
      reasoning: expect.stringContaining("FR"),
      scope: { kind: "document" },
    });
    expect(resolveLineRate(decision, context, undefined)).toBe("0");
  });

  it("row 12 (T-135/P-34): the cross-border override refuses outside its scope (domestic buyer, non-EU buyer, goods, or B2C)", () => {
    const domestic: TaxContext = {
      ...BASE,
      supplyType: "services",
      regimeOverride: { kind: "reverse-charge-cross-border" },
    };
    expect(() => decideVatCategory(domestic)).toThrow(TaxRuleError);

    const nonEu: TaxContext = {
      ...BASE,
      buyerCountry: "US",
      supplyType: "services",
      regimeOverride: { kind: "reverse-charge-cross-border" },
    };
    expect(() => decideVatCategory(nonEu)).toThrow(TaxRuleError);

    const goods: TaxContext = {
      ...BASE,
      buyerCountry: "FR",
      supplyType: "goods",
      regimeOverride: { kind: "reverse-charge-cross-border" },
    };
    expect(() => decideVatCategory(goods)).toThrow(TaxRuleError);

    const b2c: TaxContext = {
      ...BASE,
      buyerCountry: "FR",
      buyerIsBusiness: false,
      supplyType: "services",
      regimeOverride: { kind: "reverse-charge-cross-border" },
    };
    expect(() => decideVatCategory(b2c)).toThrow(TaxRuleError);
  });

  it("row 5's domestic reverse-charge override still refuses in a cross-border context and names row 12's own override instead", () => {
    const context: TaxContext = {
      ...BASE,
      buyerCountry: "FR",
      supplyType: "services",
      regimeOverride: { kind: "reverse-charge" },
    };
    expect(() => decideVatCategory(context)).toThrow(TaxRuleError);
    expect(() => decideVatCategory(context)).toThrow(/reverse-charge-cross-border/);
  });

  it("row 13: DE → non-EU B2B service refuses as CONTESTED, not the export branch (P-16/P-20)", () => {
    const context: TaxContext = { ...BASE, buyerCountry: "US", supplyType: "services" };
    expect(() => decideVatCategory(context)).toThrow(TaxRuleError);
    expect(() => decideVatCategory(context)).toThrow(/CONTESTED/);
  });

  it("cross-border + mixed supplyType refuses with a distinct error class, not generic TaxRuleError", () => {
    const context: TaxContext = { ...BASE, buyerCountry: "FR", supplyType: "mixed" };
    expect(() => decideVatCategory(context)).toThrow(MixedSupplyCrossBorderError);
  });

  it("a domestic order ignores supplyType entirely — mixed stays S, same as goods (D-50 point 2)", () => {
    const context: TaxContext = { ...BASE, supplyType: "mixed" };
    const decision = decideVatCategory(context);
    expect(decision.categoryCode).toBe("S");
    expect(decision.ruleId).toBe("tax-semantics#1");
  });
});

describe("refusal codes (T-077)", () => {
  function codeOf(run: () => unknown): string | undefined {
    try {
      run();
    } catch (error) {
      return (error as { readonly code?: string }).code;
    }
    return undefined;
  }
  const intraEu: TaxContext = { ...BASE, buyerCountry: "FR", buyerVatId: "FR12345678901" };
  const valid = (vatId: string): VatIdEvidence => ({
    vatId,
    status: "valid",
    checkedAt: "2026-09-14",
  });

  it("names each reason decideVatCategory refuses with its own code", () => {
    expect(codeOf(() => decideVatCategory({ ...BASE, sellerCountry: "NL" }))).toBe(
      "UNSUPPORTED_SELLER_COUNTRY",
    );
    expect(
      codeOf(() =>
        decideVatCategory({
          ...intraEu,
          regimeOverride: { kind: "exempt", reasonText: "§4 Nr. 14 UStG" },
        }),
      ),
    ).toBe("OVERRIDE_OUT_OF_SCOPE");
    expect(codeOf(() => decideVatCategory({ ...intraEu, supplyType: "services" }))).toBe(
      "CROSS_BORDER_SERVICE_UNDECLARED",
    );
    expect(codeOf(() => decideVatCategory({ ...intraEu, buyerVatId: "DE987654321" }))).toBe(
      "BUYER_VAT_ID_DOMESTIC",
    );
    expect(codeOf(() => decideVatCategory(intraEu, valid("FR99999999999")))).toBe(
      "BUYER_VAT_ID_MISMATCH",
    );
    expect(codeOf(() => decideVatCategory(intraEu))).toBe("VAT_ID_UNVERIFIED");
    expect(
      codeOf(() => decideVatCategory({ ...BASE, buyerCountry: "US", supplyType: "services" })),
    ).toBe("NON_EU_SERVICE_UNSUPPORTED");
    expect(
      codeOf(() =>
        decideVatCategory({
          ...BASE,
          buyerCountry: "FR",
          buyerIsBusiness: false,
          ossRegistered: true,
        }),
      ),
    ).toBe("OSS_RATE_MISSING");
    expect(
      codeOf(() => decideVatCategory({ ...BASE, supplyType: "mixed", buyerCountry: "FR" })),
    ).toBe("MIXED_SUPPLY_CROSS_BORDER");
  });

  it("names no VAT-ID in the message of a refusal about one — a caller logs it (AGENTS.md §5.2)", () => {
    const refusals = [
      () => decideVatCategory({ ...intraEu, buyerVatId: "DE987654321" }),
      () => decideVatCategory(intraEu, valid("FR99999999999")),
      () => decideVatCategory(intraEu),
    ];
    for (const refuse of refusals) {
      expect(refuse).toThrow(TaxRuleError);
      try {
        refuse();
      } catch (error) {
        expect((error as Error).message).not.toMatch(/DE987654321|FR99999999999|FR12345678901/);
      }
    }
  });

  it("resolves a domestic line at the rates of its supply date: 16 % and 5 % in the second half of 2020 (T-199)", () => {
    const decision = decideVatCategory(BASE);
    expect(resolveLineRate(decision, BASE, "standard", undefined, "2020-08-01")).toBe("16");
    expect(resolveLineRate(decision, BASE, "reduced", undefined, "2020-08-01")).toBe("5");
    expect(resolveLineRate(decision, BASE, undefined, "16", "2020-12-31")).toBe("16");
    expect(resolveLineRate(decision, BASE, undefined, "19", "2021-01-01")).toBe("19");
  });

  it("refuses a line charged at the rate of another period than its supply date — the rate changed in between (T-199)", () => {
    const decision = decideVatCategory(BASE);
    expect(codeOf(() => resolveLineRate(decision, BASE, undefined, "16", "2021-01-05"))).toBe(
      "RATE_NOT_IN_FORCE_ON_SUPPLY_DATE",
    );
    expect(() => resolveLineRate(decision, BASE, undefined, "7", "2020-07-01")).toThrow(
      /charged 7% VAT, Germany's reduced rate from 2007-01-01 to 2020-06-30, but it was supplied on 2020-07-01/,
    );
    expect(codeOf(() => resolveLineRate(decision, BASE, undefined, "0", "2021-01-05"))).toBe(
      "UNSUPPORTED_CHARGED_RATE",
    );
    expect(codeOf(() => resolveLineRate(decision, BASE, "standard", undefined, "2006-12-31"))).toBe(
      "SUPPLY_DATE_BEFORE_RATE_TABLE",
    );
  });

  it("names each reason resolveLineRate refuses with its own code", () => {
    const decision = decideVatCategory(BASE);
    expect(codeOf(() => resolveLineRate(decision, BASE, undefined, "16"))).toBe(
      "UNSUPPORTED_CHARGED_RATE",
    );
    expect(codeOf(() => resolveLineRate(decision, BASE, "standard", "7"))).toBe(
      "CHARGED_RATE_MISMATCH",
    );
    expect(codeOf(() => resolveLineRate(decision, BASE, undefined))).toBe("LINE_RATE_UNKNOWN");
    expect(codeOf(() => resolveLineRate(decision, BASE, undefined, "19%"))).toBe(
      "INVALID_CHARGED_RATE",
    );
  });

  it("links each code to its explanation", () => {
    try {
      decideVatCategory(intraEu);
    } catch (error) {
      expect(error).toBeInstanceOf(TaxRuleError);
      expect((error as TaxRuleError).docsUrl).toBe(
        "https://normwerk.dev/einvoice/docs/errors#vat-id-unverified",
      );
      expect((error as TaxRuleError).ruleId).toBe("tax-semantics#3");
    }
  });
});
