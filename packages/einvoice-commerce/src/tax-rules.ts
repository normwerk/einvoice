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
import { EinvoiceError } from "@normwerk/einvoice-model";
import type { CommerceErrorCode, TaxRuleCode } from "./error-codes.js";
import { EU_MEMBER_STATES, SUPPORTED_SELLER_COUNTRIES } from "./supported-jurisdictions.js";
import { compareDecimals } from "./decimal.js";
import type { TaxContext, TaxDecision, TaxDecisionScope, VatIdEvidence } from "./types.js";

/** UStG §12 Abs. 1 — docs/tax-semantics.md row 1. */
export const DE_STANDARD_RATE = "19";
/** UStG §12 Abs. 2 Nr. 1 + Anlage 2 — docs/tax-semantics.md row 2. */
export const DE_REDUCED_RATE = "7";

export { EU_MEMBER_STATES };

/** Compares VAT-IDs the way VIES does — ignoring case, spaces, dots and dashes — so a formatting difference
 * is never mistaken for a different number, and a different number is never mistaken for the same one. */
export function normalizeVatId(vatId: string): string {
  return vatId.replace(/[\s.-]/g, "").toUpperCase();
}

/** A refusal to decide the VAT, with the `docs/tax-semantics.md` row it is about (`ruleId`) and why (`code`). */
export class TaxRuleError extends EinvoiceError<TaxRuleCode> {
  constructor(
    code: TaxRuleCode,
    message: string,
    readonly ruleId: string,
  ) {
    super(code, message);
    this.name = "TaxRuleError";
  }
}

/** T-069/D-50 point 3: a cross-border order with `supplyType: "mixed"` has no single correct category for
 * the whole document — its own distinct class (not generic `TaxRuleError`) so a caller can catch this
 * specific, expected-and-actionable refusal instead of pattern-matching message text, which would break
 * the moment the message wording changes. */
export class MixedSupplyCrossBorderError extends EinvoiceError<CommerceErrorCode> {
  constructor(readonly ruleId: string) {
    super(
      "MIXED_SUPPLY_CROSS_BORDER",
      'A cross-border order with supplyType "mixed" (goods and services on one document) has no single ' +
        "correct EN 16931 category — decideVatCategory resolves exactly one category per document " +
        "(docs/tax-semantics.md's own rule; row 9's mixed rates are still one category, S, just two rates). " +
        'Two real outs: issue two separate invoices, one per supply type; or tag the line "goods" if the ' +
        "service is genuinely ancillary to it (a single Werklieferung, §3 Abs. 7 UStG — a question of fact " +
        "for you and your tax advisor). Splitting the order into separate fulfillments does not split the " +
        "invoice.",
    );
    this.name = "MixedSupplyCrossBorderError";
  }
}

const DOCUMENT_SCOPE: TaxDecisionScope = { kind: "document" };

const REVERSE_CHARGE_DEFAULT_TEXT =
  "Steuerschuldnerschaft des Leistungsempfängers (§13b UStG) / Reverse charge";

/** T-135/P-34 — row 12's cross-border counterpart to `REVERSE_CHARGE_DEFAULT_TEXT`, a different legal basis
 * (§3a Abs. 2 UStG / Art. 44+196 VAT Directive, not §13b UStG). */
const CROSS_BORDER_REVERSE_CHARGE_DEFAULT_TEXT =
  "Steuerschuldnerschaft des Leistungsempfängers (§3a Abs. 2 UStG / Art. 44+196 VAT Directive) / Reverse charge";

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
  if (!SUPPORTED_SELLER_COUNTRIES.includes(context.sellerCountry)) {
    throw new TaxRuleError(
      "UNSUPPORTED_SELLER_COUNTRY",
      `decideVatCategory only covers a German seller in this release — got sellerCountry "${context.sellerCountry}"`,
      "tax-semantics#scope",
    );
  }

  const override = context.regimeOverride;

  // Rows 6 and 8 are domestic regimes: §12 Abs. 3 UStG (the only German zero rate) and the §4 UStG
  // exemptions this table documents apply to a supply taxable in Germany. Without this guard the two
  // overrides — checked ahead of every other branch — let a merchant stamp E or Z on a cross-border order
  // and skip the VIES gate (row 3) and the row 12/13 refusals entirely (P-45), the same scope the
  // reverse-charge overrides below already enforce.
  if (
    (override?.kind === "zero-rated" || override?.kind === "exempt") &&
    context.buyerCountry !== "DE"
  ) {
    const row = override.kind === "zero-rated" ? 8 : 6;
    throw new TaxRuleError(
      "OVERRIDE_OUT_OF_SCOPE",
      `${override.kind} override given for a buyer in ${context.buyerCountry} — docs/tax-semantics.md row ` +
        `${row} covers a domestic (DE → DE) supply only. A cross-border order takes its category from the ` +
        `intra-EU, export, OSS or reverse-charge rows instead.`,
      `tax-semantics#${row}`,
    );
  }

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
      scope: DOCUMENT_SCOPE,
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
      scope: DOCUMENT_SCOPE,
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
        "OVERRIDE_OUT_OF_SCOPE",
        "reverse-charge override given for a non-domestic-B2B transaction — docs/tax-semantics.md row 5 " +
          "is DE→DE B2B only; a cross-border reverse-charge service is row 12's own " +
          'regimeOverride: { kind: "reverse-charge-cross-border" } instead — a different legal ' +
          "basis (§3a Abs. 2 UStG / Art. 44+196 VAT Directive, not §13b UStG), not an extension of this " +
          "override.",
        "tax-semantics#5",
      );
    }
    return {
      ruleId: "tax-semantics#5",
      categoryCode: "AE",
      exemptionReasonCode: "VATEX-EU-AE",
      exemptionReasonText: override.reasonText ?? REVERSE_CHARGE_DEFAULT_TEXT,
      reasoning: "Domestic B2B reverse-charge service (§13b UStG), explicit override.",
      scope: DOCUMENT_SCOPE,
    };
  }

  // Row 12: DE → EU B2B service via an explicit override (T-135/P-34). The category itself is settled (AE,
  // §3a Abs. 2 UStG; Art. 44+196 VAT Directive) but the default branch below refuses pending M-006 (no
  // official artifact confirms a real validator accepts it) — this lets a merchant declare the fact anyway,
  // the same "accept a declared fact, never infer it" shape row 3's `intra-eu-confirmed` override already
  // uses for K (D-37: the engine still never infers AE here on its own). Checked ahead of `buyerIsEu`/
  // `isCrossBorder` (computed below) since its own validity check duplicates just enough of that logic to
  // give a scoped error message rather than reuse a shared boolean two branches down.
  if (override?.kind === "reverse-charge-cross-border") {
    if (
      context.sellerCountry !== "DE" ||
      context.buyerCountry === "DE" ||
      !EU_MEMBER_STATES.has(context.buyerCountry) ||
      !context.buyerIsBusiness ||
      context.supplyType !== "services"
    ) {
      throw new TaxRuleError(
        "OVERRIDE_OUT_OF_SCOPE",
        "reverse-charge-cross-border override given outside its scope — docs/tax-semantics.md row 12 is " +
          "DE→(other EU state) B2B service only. A domestic reverse-charge service is row 5's " +
          '"reverse-charge" override instead; a non-EU B2B service is row 13, which has no override: its ' +
          "category is not settled, so this package refuses it.",
        "tax-semantics#12",
      );
    }
    return {
      ruleId: "tax-semantics#12",
      categoryCode: "AE",
      exemptionReasonCode: "VATEX-EU-AE",
      exemptionReasonText: override.reasonText ?? CROSS_BORDER_REVERSE_CHARGE_DEFAULT_TEXT,
      reasoning:
        `Explicit cross-border reverse-charge override — intra-EU B2B service, place of supply in buyer ` +
        `country ${context.buyerCountry} (§3a Abs. 2 UStG; Art. 44+196 VAT Directive).`,
      scope: DOCUMENT_SCOPE,
    };
  }

  const buyerIsEu = EU_MEMBER_STATES.has(context.buyerCountry);
  const isCrossBorder = context.buyerCountry !== context.sellerCountry;

  // T-069/D-50 point 3: a cross-border order mixing goods and services has no single correct category —
  // checked ahead of every country-specific branch below, since it's a blanket rule regardless of whether
  // the buyer is in the EU or not (a domestic mixed basket is fine — D-50 point 2 — so this only fires
  // cross-border).
  if (isCrossBorder && context.supplyType === "mixed") {
    throw new MixedSupplyCrossBorderError("tax-semantics#mixed-cross-border");
  }

  // Row 12: DE→EU B2B service, no explicit override given (the override branch above already returned/threw
  // otherwise). The category itself is settled (AE, §3a Abs. 2 UStG; Art. 44+196 VAT Directive) — but
  // docs/tax-semantics.md row 12 is explicit that no official artifact confirms a real validator accepts it,
  // and the code must refuse, not guess, until M-006 clears it, unless the merchant has already declared the
  // fact via regimeOverride: { kind: "reverse-charge-cross-border" } (T-135/P-34). Checked ahead of row 3 (K)
  // so a service no longer falls into the goods-only intra-EU branch (P-16/P-20).
  if (
    context.sellerCountry === "DE" &&
    buyerIsEu &&
    context.buyerCountry !== "DE" &&
    context.buyerIsBusiness &&
    context.supplyType === "services"
  ) {
    throw new TaxRuleError(
      "CROSS_BORDER_SERVICE_UNDECLARED",
      `DE→EU B2B service to ${context.buyerCountry} (docs/tax-semantics.md row 12) has a settled category ` +
        `(AE) but no official artifact example confirms a real validator accepts it — refusing rather than ` +
        `guessing, per that row's own documented rule. If the supply is one, declare it: ` +
        `regimeOverride: { kind: "reverse-charge-cross-border" }.`,
      "tax-semantics#12",
    );
  }

  // Row 3: intra-EU supply of goods — needs either a positive VIES check or an explicit manual-confirmation
  // override (D-19: "не выбираются без положительной проверки или явного override"). `supplyType !==
  // "services"` is defensive (row 12 above already intercepts every EU-B2B-service case that would reach
  // here) rather than load-bearing on its own.
  if (
    context.sellerCountry === "DE" &&
    buyerIsEu &&
    context.buyerCountry !== "DE" &&
    context.buyerIsBusiness &&
    context.buyerVatId !== undefined &&
    context.supplyType !== "services"
  ) {
    const buyerVatId = normalizeVatId(context.buyerVatId);
    if (buyerVatId.startsWith("DE")) {
      throw new TaxRuleError(
        "BUYER_VAT_ID_DOMESTIC",
        `Intra-EU supply needs a buyer VAT-ID issued by another member state (§6a Abs. 1 Nr. 4 UStG, ` +
          `Art. 138(1) VAT Directive) — got the German VAT-ID ${context.buyerVatId}. Refusing category K.`,
        "tax-semantics#3",
      );
    }
    if (vatIdEvidence?.status === "valid") {
      if (normalizeVatId(vatIdEvidence.vatId) !== buyerVatId) {
        throw new TaxRuleError(
          "BUYER_VAT_ID_MISMATCH",
          `The positive VIES check is for VAT-ID ${vatIdEvidence.vatId}, not for the buyer's ` +
            `${context.buyerVatId} — refusing category K on evidence about a different number.`,
          "tax-semantics#3",
        );
      }
      return {
        ruleId: "tax-semantics#3",
        categoryCode: "K",
        exemptionReasonCode: "VATEX-EU-IC",
        exemptionReasonText:
          "Innergemeinschaftliche Lieferung (§4 Nr. 1b, §6a UStG) / Intra-Community supply",
        reasoning: `Buyer VAT-ID ${context.buyerVatId} confirmed valid by VIES (consultation ${vatIdEvidence.consultationNumber ?? "n/a"}, checked ${vatIdEvidence.checkedAt}).`,
        scope: DOCUMENT_SCOPE,
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
        scope: DOCUMENT_SCOPE,
      };
    }
    throw new TaxRuleError(
      "VAT_ID_UNVERIFIED",
      `Intra-EU supply to buyer VAT-ID ${context.buyerVatId} needs a positive VIES check (vatIdEvidence.status === "valid") ` +
        `or an explicit regimeOverride: { kind: "intra-eu-confirmed" } — refusing to select category K on an ` +
        `unverified VAT-ID. This does not need to block the underlying order — defer invoice issuance ` +
        `until the check resolves.`,
      "tax-semantics#3",
    );
  }

  // Row 13: DE→non-EU B2B service — CONTESTED (docs/tax-semantics.md row 13: no artifact resolves AE / O /
  // G, and EU Commission tax-code guidance explicitly disclaims Commission authority). Checked ahead of row
  // 4 (G) so a service no longer silently falls into the export branch (P-16/P-20).
  if (
    context.sellerCountry === "DE" &&
    !buyerIsEu &&
    context.buyerIsBusiness &&
    context.supplyType === "services"
  ) {
    throw new TaxRuleError(
      "NON_EU_SERVICE_UNSUPPORTED",
      `DE→non-EU B2B service to ${context.buyerCountry} (docs/tax-semantics.md row 13) is CONTESTED — no ` +
        `artifact resolves whether this is AE, O, or G. Refusing rather than guessing; an explicit ` +
        `regimeOverride is the only way to force a specific outcome, and none exists for this case.`,
      "tax-semantics#13",
    );
  }

  // Row 4: export outside the EU. `supplyType !== "services"` excludes the case row 13 now owns.
  if (context.sellerCountry === "DE" && !buyerIsEu && context.supplyType !== "services") {
    return {
      ruleId: "tax-semantics#4",
      categoryCode: "G",
      exemptionReasonCode: "VATEX-EU-G",
      exemptionReasonText: "Ausfuhrlieferung (§4 Nr. 1a, §6 UStG) / Export outside the EU",
      reasoning: `Buyer country ${context.buyerCountry} is outside the EU.`,
      scope: DOCUMENT_SCOPE,
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
        "OSS_RATE_MISSING",
        `OSS distance sale to ${context.buyerCountry} needs taxContext.ossRateOverride — this package does ` +
          `not maintain a table of EU member states' VAT rates (docs/tax-semantics.md row 7).`,
        "tax-semantics#7",
      );
    }
    // P-46: a rate of 0 would put a zero-rated supply under category S, which BR-S-05 rejects; every EU
    // member state's standard rate is above zero.
    if (
      !/^\d+(\.\d+)?$/.test(context.ossRateOverride) ||
      compareDecimals(context.ossRateOverride, "0") <= 0
    ) {
      throw new TaxRuleError(
        "OSS_RATE_INVALID",
        `taxContext.ossRateOverride "${context.ossRateOverride}" is not a VAT rate above zero — an OSS ` +
          `distance sale is taxed at the destination country's rate (docs/tax-semantics.md row 7).`,
        "tax-semantics#7",
      );
    }
    // P-46: only a sale of goods moves to the buyer's country. A service to a consumer is, as a rule, taxed
    // where the seller is (§3a Abs. 1 UStG); only the services §3a Abs. 5 UStG lists (telecommunications,
    // broadcasting, electronically supplied services) are taxed where the consumer lives, and nothing in
    // TaxContext tells the two apart. A mixed order never gets here: it is refused above as cross-border.
    if (context.supplyType !== "goods") {
      throw new TaxRuleError(
        "OSS_SERVICES_UNSUPPORTED",
        `OSS sale of services to a consumer in ${context.buyerCountry} — this package covers OSS distance ` +
          `sales of goods only. A service to a consumer is taxed in Germany as a rule (§3a Abs. 1 UStG), ` +
          `and in the consumer's country only for the services §3a Abs. 5 UStG lists; which one this is ` +
          `cannot be read from the order, so it is refused rather than guessed (docs/tax-semantics.md row 7).`,
        "tax-semantics#7",
      );
    }
    return {
      ruleId: "tax-semantics#7",
      categoryCode: "S",
      reasoning:
        `OSS one-stop-shop distance sale; rate is buyer country ${context.buyerCountry}'s own, supplied via ` +
        `ossRateOverride (Art. 33 VAT Directive). Outside the German B2B/B2G mandate; rate supplied by the ` +
        `caller, see docs/tax-semantics.md row 7.`,
      scope: DOCUMENT_SCOPE,
    };
  }

  // Row 1/2: domestic. Rate itself is resolved per line (resolveLineRate) since it can vary line-to-line
  // (row 9, mixed rates) — this decision only fixes the category and cites the regime. `supplyType` is
  // deliberately never consulted here (D-50 point 2): a domestic goods+service basket stays S regardless of
  // composition — mixing is only a problem cross-border, where two different categories would collide.
  if (context.sellerCountry === "DE" && context.buyerCountry === "DE") {
    return {
      ruleId: "tax-semantics#1",
      categoryCode: "S",
      reasoning: "Domestic DE→DE supply, standard VAT regime (UStG §12).",
      scope: DOCUMENT_SCOPE,
    };
  }

  throw new TaxRuleError(
    "NO_TAX_RULE",
    `No rule in docs/tax-semantics.md matches this TaxContext (seller ${context.sellerCountry}, buyer ` +
      `${context.buyerCountry}, buyerIsBusiness ${context.buyerIsBusiness}, ossRegistered ${context.ossRegistered}) ` +
      `— refusing to guess a category rather than silently producing a document nobody reviewed this scenario for.`,
    "tax-semantics#unresolved",
  );
}

/** The rate kind a charged rate is, when it is exactly one of Germany's rates. */
function germanRateKind(rate: string): "standard" | "reduced" | undefined {
  if (compareDecimals(rate, DE_STANDARD_RATE) === 0) return "standard";
  if (compareDecimals(rate, DE_REDUCED_RATE) === 0) return "reduced";
  return undefined;
}

/**
 * Resolves the per-line rate for a category-S decision (domestic standard/
 * reduced, docs/tax-semantics.md rows 1/2/9, or OSS row 7). Categories that
 * are uniform for the whole transaction (K/G/AE/E/Z) never call this — their
 * rate is always "0", fixed in `decideVatCategory`'s own `TaxDecision`.
 *
 * `chargedVatRate` is the rate the shop charged on the line (`CommerceLine.chargedVatRate`). A line is never
 * invoiced at a rate other than the one it was charged at: a domestic line charged at anything but 19% or 7%,
 * or classified as one and charged the other, is refused (P-50); so is an OSS line charged at anything but
 * the declared destination rate, or classified as reduced (P-46) — the one declared rate is the destination's
 * standard rate, and a reduced destination rate cannot be declared yet.
 */
export function resolveLineRate(
  decision: TaxDecision,
  context: TaxContext,
  taxRateKind: "standard" | "reduced" | undefined,
  chargedVatRate?: string | undefined,
): string {
  if (decision.categoryCode !== "S") {
    return "0";
  }
  if (chargedVatRate !== undefined && !/^\d+(\.\d+)?$/.test(chargedVatRate)) {
    throw new TaxRuleError(
      "INVALID_CHARGED_RATE",
      `chargedVatRate "${chargedVatRate}" is not a VAT rate (a percentage such as "19").`,
      decision.ruleId,
    );
  }
  if (decision.ruleId === "tax-semantics#7") {
    // OSS: already validated present in decideVatCategory; re-checked here defensively since this
    // function can in principle be called independently of decideVatCategory in a test.
    const ossRate = context.ossRateOverride;
    if (ossRate === undefined) {
      throw new TaxRuleError(
        "OSS_RATE_MISSING",
        "OSS rate missing — see decideVatCategory",
        "tax-semantics#7",
      );
    }
    if (taxRateKind === "reduced") {
      throw new TaxRuleError(
        "OSS_REDUCED_RATE_UNSUPPORTED",
        `An OSS order with a reduced-rate line: taxContext.ossRateOverride declares one rate for the order, ` +
          `the destination country's standard rate, and a reduced destination rate cannot be declared yet. ` +
          `Refusing rather than invoicing the line at ${ossRate}%.`,
        "tax-semantics#7",
      );
    }
    if (chargedVatRate !== undefined && compareDecimals(chargedVatRate, ossRate) !== 0) {
      throw new TaxRuleError(
        "OSS_RATE_MISMATCH",
        `An OSS order line was charged ${chargedVatRate}% VAT, not the declared destination rate ` +
          `${ossRate}% (taxContext.ossRateOverride). Refusing rather than invoicing a rate the buyer was ` +
          `not charged; a reduced destination rate cannot be declared yet.`,
        "tax-semantics#7",
      );
    }
    return ossRate;
  }
  const chargedKind = chargedVatRate === undefined ? undefined : germanRateKind(chargedVatRate);
  if (chargedVatRate !== undefined && chargedKind === undefined) {
    throw new TaxRuleError(
      "UNSUPPORTED_CHARGED_RATE",
      `A domestic line was charged ${chargedVatRate}% VAT, which is neither of Germany's rates (19%, 7%). ` +
        `Refusing rather than invoicing a rate the buyer was not charged — check the shop's tax settings.`,
      "tax-semantics#1",
    );
  }
  if (taxRateKind !== undefined && chargedKind !== undefined && taxRateKind !== chargedKind) {
    throw new TaxRuleError(
      "CHARGED_RATE_MISMATCH",
      `A domestic line is classified as ${taxRateKind} rate but was charged ${chargedVatRate}% VAT — ` +
        `refusing to pick one of the two.`,
      "tax-semantics#1",
    );
  }
  const kind = taxRateKind ?? chargedKind;
  if (kind === undefined) {
    throw new TaxRuleError(
      "LINE_RATE_UNKNOWN",
      "A domestic line needs taxRateKind ('standard' | 'reduced') or the rate the shop charged " +
        "(chargedVatRate) to resolve its rate — refusing to default to either 19% or 7% silently.",
      "tax-semantics#1",
    );
  }
  return kind === "reduced" ? DE_REDUCED_RATE : DE_STANDARD_RATE;
}
