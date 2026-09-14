/**
 * T-061/W9: the VAT-category rule table (`docs/tax-semantics.md`, plan-v0.1
 * §3.5) as executable code — one branch per row, `docs/tax-semantics.md`'s
 * own row number carried into every `TaxDecision.ruleId` so a failing test
 * or a disputed category points straight back at the documented norm
 * source. `decideVatCategory` is deliberately a plain, synchronous, pure
 * function (ADR-001: no I/O in this layer) — VIES verification (async, I/O)
 * happens before calling it, and its result is passed in as `vatIdEvidence`.
 *
 * Scope: Germany only (`STRATEGY.md` §2, v0.1). `sellerCountry` other than
 * `"DE"` is refused outright rather than silently reusing Germany's rates
 * or regime logic for a jurisdiction this table was never reviewed against.
 */
import type { CountryCode } from "@normwerk/einvoice-model";
import type { TaxContext, TaxDecision, VatIdEvidence } from "./types.js";

/** UStG §12 Abs. 1 — docs/tax-semantics.md row 1. */
export const DE_STANDARD_RATE = "19";
/** UStG §12 Abs. 2 Nr. 1 + Anlage 2 — docs/tax-semantics.md row 2. */
export const DE_REDUCED_RATE = "7";

/**
 * The 27 EU member states (ISO 3166-1 alpha-2), current as of this repo's
 * scope (post-Brexit; the UK is not included). A well-known public fact,
 * not sourced from a specific vendored artifact — same "well-known"
 * provenance honesty this repo already uses for facts like this
 * (`tools/codegen/model/terms.mjs`'s `verified: "well-known"` tier) rather
 * than falsely implying it was extracted from an EN 16931 artifact.
 */
export const EU_MEMBER_STATES: ReadonlySet<CountryCode> = new Set([
  "AT",
  "BE",
  "BG",
  "HR",
  "CY",
  "CZ",
  "DK",
  "EE",
  "FI",
  "FR",
  "DE",
  "GR",
  "HU",
  "IE",
  "IT",
  "LV",
  "LT",
  "LU",
  "MT",
  "NL",
  "PL",
  "PT",
  "RO",
  "SK",
  "SI",
  "ES",
  "SE",
] as const);

export class TaxRuleError extends Error {
  constructor(
    message: string,
    readonly ruleId: string,
  ) {
    super(message);
    this.name = "TaxRuleError";
  }
}

const REVERSE_CHARGE_DEFAULT_TEXT =
  "Steuerschuldnerschaft des Leistungsempfängers (§13b UStG) / Reverse charge";

/**
 * Resolves the VAT category/exemption for the whole commercial transaction
 * (`docs/tax-semantics.md` rows 1–8; row 9 — mixed rates — is not a
 * separate regime, it's two lines both resolving to category S with
 * different rates, handled per-line by `resolveLineRate`; row 10 — credit
 * note — reuses whatever regime applied to the corrected transaction and
 * is handled by `buildInvoice`, not here).
 *
 * Throws `TaxRuleError` rather than guessing whenever the facts given
 * don't unambiguously resolve to exactly one row — an unresolved K/AE/E/Z
 * case must not silently fall through to a domestic-standard-rate guess.
 */
export function decideVatCategory(context: TaxContext, vatIdEvidence?: VatIdEvidence): TaxDecision {
  if (context.sellerCountry !== "DE") {
    throw new TaxRuleError(
      `decideVatCategory only covers a German seller (v0.1 scope, STRATEGY.md §2) — got sellerCountry "${context.sellerCountry}"`,
      "tax-semantics#scope",
    );
  }

  const override = context.regimeOverride;

  // Row 8: zero-rated — always an explicit override (rare in DE; RegimeOverride's
  // "zero-rated" variant carries no reason text/code field, so BR-Z-10's "no
  // exemption text on a Z line" is enforced at the type level, not here).
  if (override?.kind === "zero-rated") {
    return {
      ruleId: "tax-semantics#8",
      categoryCode: "Z",
      reasoning:
        "Explicit zero-rated override (regimeOverride.kind === 'zero-rated') — rare in DE; kept for " +
        "code-coverage completeness (docs/tax-semantics.md row 8). No BT-120/121 exemption text is " +
        "attached: BR-Z-10 forbids one on a Z line.",
    };
  }

  // Row 6: exempt — always an explicit override; no automatic derivation exists (which specific UStG §4
  // exemption applies is a case-by-case legal judgment, docs/tax-semantics.md row 6).
  if (override?.kind === "exempt") {
    return {
      ruleId: "tax-semantics#6",
      categoryCode: "E",
      exemptionReasonText: override.reasonText,
      exemptionReasonCode: override.reasonCode,
      reasoning: `Explicit exempt override (UStG §4, case-by-case): ${override.reasonText}`,
    };
  }

  // Row 5: reverse charge — always an explicit override (a domestic B2B service is reverse-charge-eligible
  // or not depending on facts, e.g. §13b UStG construction subcontracting, that TaxContext's other fields
  // cannot express).
  if (override?.kind === "reverse-charge") {
    if (
      context.sellerCountry !== "DE" ||
      context.buyerCountry !== "DE" ||
      !context.buyerIsBusiness
    ) {
      throw new TaxRuleError(
        "reverse-charge override given for a non-domestic-B2B transaction — docs/tax-semantics.md row 5 " +
          "is DE→DE B2B only; a cross-border reverse-charge scenario is a different EN 16931 category " +
          "(not covered by this v0.1 rule table)",
        "tax-semantics#5",
      );
    }
    return {
      ruleId: "tax-semantics#5",
      categoryCode: "AE",
      exemptionReasonCode: "VATEX-EU-AE",
      exemptionReasonText: override.reasonText ?? REVERSE_CHARGE_DEFAULT_TEXT,
      reasoning: "Domestic B2B reverse-charge service (§13b UStG), explicit override.",
    };
  }

  const buyerIsEu = EU_MEMBER_STATES.has(context.buyerCountry);

  // Row 3: intra-EU supply — needs either a positive VIES check or an explicit manual-confirmation
  // override (D-19: "не выбираются без положительной проверки или явного override").
  if (
    context.sellerCountry === "DE" &&
    buyerIsEu &&
    context.buyerCountry !== "DE" &&
    context.buyerIsBusiness &&
    context.buyerVatId !== undefined
  ) {
    if (vatIdEvidence?.status === "valid") {
      return {
        ruleId: "tax-semantics#3",
        categoryCode: "K",
        exemptionReasonCode: "VATEX-EU-IC",
        exemptionReasonText:
          "Innergemeinschaftliche Lieferung (§4 Nr. 1b, §6a UStG) / Intra-Community supply",
        reasoning: `Buyer VAT-ID ${context.buyerVatId} confirmed valid by VIES (consultation ${vatIdEvidence.consultationNumber ?? "n/a"}, checked ${vatIdEvidence.checkedAt}).`,
      };
    }
    if (override?.kind === "intra-eu-confirmed") {
      return {
        ruleId: "tax-semantics#3",
        categoryCode: "K",
        exemptionReasonCode: "VATEX-EU-IC",
        exemptionReasonText:
          "Innergemeinschaftliche Lieferung (§4 Nr. 1b, §6a UStG) / Intra-Community supply",
        reasoning: `VIES unavailable; manually confirmed — ${override.evidenceNote}`,
      };
    }
    throw new TaxRuleError(
      `Intra-EU supply to buyer VAT-ID ${context.buyerVatId} needs a positive VIES check (vatIdEvidence.status === "valid") ` +
        `or an explicit regimeOverride: { kind: "intra-eu-confirmed" } — refusing to select category K on an ` +
        `unverified VAT-ID (D-19). This does not need to block the underlying order — defer invoice issuance ` +
        `until the check resolves.`,
      "tax-semantics#3",
    );
  }

  // Row 4: export outside the EU.
  if (context.sellerCountry === "DE" && !buyerIsEu) {
    return {
      ruleId: "tax-semantics#4",
      categoryCode: "G",
      exemptionReasonCode: "VATEX-EU-G",
      exemptionReasonText: "Ausfuhrlieferung (§4 Nr. 1a, §6 UStG) / Export outside the EU",
      reasoning: `Buyer country ${context.buyerCountry} is outside the EU.`,
    };
  }

  // Row 7: OSS distance sale (B2C, cross-border EU, OSS-registered). Rate is the buyer country's own —
  // this package has no EU rate table (see TaxContext.ossRateOverride doc comment) and refuses to guess.
  if (
    context.sellerCountry === "DE" &&
    buyerIsEu &&
    context.buyerCountry !== "DE" &&
    !context.buyerIsBusiness &&
    context.ossRegistered
  ) {
    if (context.ossRateOverride === undefined) {
      throw new TaxRuleError(
        `OSS distance sale to ${context.buyerCountry} needs taxContext.ossRateOverride — this package does ` +
          `not maintain a table of EU member states' VAT rates (docs/tax-semantics.md row 7, flagged for ` +
          `expert review).`,
        "tax-semantics#7",
      );
    }
    return {
      ruleId: "tax-semantics#7",
      categoryCode: "S",
      reasoning:
        `OSS one-stop-shop distance sale; rate is buyer country ${context.buyerCountry}'s own, supplied via ` +
        `ossRateOverride (Art. 33 VAT Directive). ⚠️ Outside the DE B2B/B2G mandate this project targets — ` +
        `docs/tax-semantics.md row 7 flags this as not fully resolved pending expert review (M-006).`,
    };
  }

  // Row 1/2: domestic. Rate itself is resolved per line (resolveLineRate) since it can vary line-to-line
  // (row 9, mixed rates) — this decision only fixes the category and cites the regime.
  if (context.sellerCountry === "DE" && context.buyerCountry === "DE") {
    return {
      ruleId: "tax-semantics#1",
      categoryCode: "S",
      reasoning: "Domestic DE→DE supply, standard VAT regime (UStG §12).",
    };
  }

  throw new TaxRuleError(
    `No rule in docs/tax-semantics.md matches this TaxContext (seller ${context.sellerCountry}, buyer ` +
      `${context.buyerCountry}, buyerIsBusiness ${context.buyerIsBusiness}, ossRegistered ${context.ossRegistered}) ` +
      `— refusing to guess a category rather than silently producing a document nobody reviewed this scenario for.`,
    "tax-semantics#unresolved",
  );
}

/**
 * Resolves the per-line rate for a category-S decision (domestic standard/
 * reduced, docs/tax-semantics.md rows 1/2/9, or OSS row 7). Categories that
 * are uniform for the whole transaction (K/G/AE/E/Z) never call this — their
 * rate is always "0", fixed in `decideVatCategory`'s own `TaxDecision`.
 */
export function resolveLineRate(
  decision: TaxDecision,
  context: TaxContext,
  taxRateKind: "standard" | "reduced" | undefined,
): string {
  if (decision.categoryCode !== "S") {
    return "0";
  }
  if (decision.ruleId === "tax-semantics#7") {
    // OSS: already validated present in decideVatCategory; re-checked here defensively since this
    // function can in principle be called independently of decideVatCategory in a test.
    if (context.ossRateOverride === undefined) {
      throw new TaxRuleError("OSS rate missing — see decideVatCategory", "tax-semantics#7");
    }
    return context.ossRateOverride;
  }
  if (taxRateKind === undefined) {
    throw new TaxRuleError(
      "A domestic-standard-rate line needs taxRateKind ('standard' | 'reduced') to resolve its rate — " +
        "refusing to default to either 19% or 7% silently.",
      "tax-semantics#1",
    );
  }
  return taxRateKind === "reduced" ? DE_REDUCED_RATE : DE_STANDARD_RATE;
}
