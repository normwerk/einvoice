/**
 * T-066/P-05 (was T-065/W9): which e-invoice profile to embed the document under, by the *recipient's*
 * expectation, not by treating "buyer country !== Germany" as a blanket gate (P-13 — T-065's own version of
 * this function refused every non-German buyer, including EU/EEA ones and Switzerland/the UK, contradicting
 * its own doc comment's claim that only DK/NO/SE were deferred).
 *
 * `EInvoiceProfileName`'s two values are the same strings
 * `@normwerk/einvoice-pdfa`'s `ZugferdProfileName` uses (`profiles.ts`) —
 * kept as a plain literal type here rather than importing that package, to
 * avoid a layer-violating dependency from this pure business-logic package
 * onto the PDF-assembly one (ADR-001: `einvoice-commerce` doesn't know PDF
 * exists). Whatever calls both packages (an adapter, or a standalone
 * script) passes this value straight through.
 *
 * Four branches (`ecom docs/todo.md` T-066's own spec):
 * 1. DE buyer with a declared `leitwegId` → `XRECHNUNG` (B2G, pure-XML delivery is mandatory there). Only
 *    a declared Leitweg-ID counts (P-54): an ordinary buyer reference such as "2024-01" has the same shape,
 *    and reading one as a B2G signal sent ordinary B2B invoices down this branch. A Leitweg-ID that fails
 *    its check digits still reaches `XRECHNUNG` here and is rejected by `buildInvoice`'s
 *    `InvalidLeitwegIdError` — this function only routes, it doesn't re-validate.
 * 2. DE buyer without a Leitweg-ID → `preferredProfile ?? "EN16931"`.
 * 3. Any other EU/EEA member, or Switzerland/the UK → `preferredProfile ?? "EN16931"` — the Factur-X-
 *    compatible EN 16931 hybrid is accepted EU-wide (and CH/UK have no e-invoice mandate of their own that
 *    would reject a hybrid PDF either). v0.2 will prefer a `PEPPOL_BIS` profile for DK/NO/SE/BE/NL instead,
 *    once `einvoice-ubl` exists — that's a future *preference* change, not a v0.1 refusal.
 * 4. A buyer in a mandatory-clearance-system country (Italy: SDI; Poland: KSeF) → `UnsupportedCountryError`
 *    naming the reason — no EN 16931 document, hybrid or pure XML, can be submitted through either system.
 * 5. Anything else (not DE, not EU/EEA, not CH/UK, not a clearance country) → `UnsupportedCountryError`
 *    with the original "not yet supported" message — v0.1 has no reviewed e-invoicing basis for it at all.
 *
 * Seller-side jurisdiction is unaffected and stays Germany-only until v0.2 (`decideVatCategory`,
 * `tax-rules.ts`) — this function only ever decides the *document format*, never the VAT category.
 */
import type { CountryCode } from "@normwerk/einvoice-model";
import { EU_MEMBER_STATES } from "./tax-rules.js";

export type EInvoiceProfileName = "EN16931" | "XRECHNUNG";

/**
 * EEA member states that are not also EU members (ISO 3166-1 alpha-2) — Iceland, Liechtenstein, Norway.
 * Verified directly against https://www.efta.int/eea ("the three EEA EFTA States — Iceland, Liechtenstein
 * and Norway"), fetched 2026-09-19 — not assumed from memory.
 */
const EEA_NON_EU_COUNTRIES: ReadonlySet<CountryCode> = new Set(["IS", "LI", "NO"]);

/**
 * Countries outside the EU/EEA that this package still accepts an EN 16931 hybrid document for (T-066):
 * Switzerland and the UK. Not an EEA-membership fact — a deliberate v0.1 acceptance decision (neither
 * country runs a clearance system of its own that would reject a Factur-X/ZUGFeRD hybrid PDF; see
 * `README.md`'s own country-roadmap table, "Swiss / UK buyer of a German seller"). Kept as its own named
 * set rather than folded into the EEA one so the two provenances stay distinguishable.
 */
const NON_EEA_ACCEPTED_COUNTRIES: ReadonlySet<CountryCode> = new Set(["CH", "GB"]);

/**
 * EU member states that run their own mandatory pre-clearance e-invoicing platform — Italy's SDI (Sistema
 * di Interscambio) and Poland's KSeF (Krajowy System e-Faktur) — each with its own national XML format, not
 * EN 16931. Neither a pure-XML XRechnung document nor a plain EN 16931 hybrid can be submitted through
 * either platform. Source: this repo's own already-verified position, `README.md`'s country-roadmap table
 * ("SDI / KSeF are clearance systems with their own XML — no EN 16931 document can serve them") and
 * `ecom docs/STRATEGY.md` §2's explicit out-of-scope list — not re-derived here. A subset of
 * `EU_MEMBER_STATES`; checked *before* the general EU/EEA/CH/UK branch, since membership alone is not
 * sufficient for these two.
 */
const CLEARANCE_MODEL_COUNTRIES: ReadonlySet<CountryCode> = new Set(["IT", "PL"]);

export type UnsupportedCountryReason = "not-yet-supported" | "clearance-model";

export class UnsupportedCountryError extends Error {
  constructor(
    readonly countryCode: CountryCode,
    readonly reason: UnsupportedCountryReason = "not-yet-supported",
  ) {
    super(
      reason === "clearance-model"
        ? `selectProfile: buyer country "${countryCode}" runs a mandatory clearance e-invoicing platform ` +
            `of its own (SDI/KSeF-style national XML) — no EN 16931 document, hybrid or pure XML, can be ` +
            `submitted through it. The document must be submitted through the national platform; that flow ` +
            `is out of scope for this package.`
        : `selectProfile: buyer country "${countryCode}" is not yet supported — v0.1 serves Germany, other ` +
            `EU/EEA member states, Switzerland, and the UK only.`,
    );
    this.name = "UnsupportedCountryError";
  }
}

export interface SelectProfileOptions {
  readonly buyerCountry: CountryCode;
  /** The buyer's declared Leitweg-ID (`CommerceInvoiceInput.references.leitwegId`): a German public-sector
   * buyer (B2G), for whom XRechnung's pure-XML delivery is mandatory; a ZUGFeRD/Factur-X hybrid PDF is not
   * an accepted substitute (unlike ordinary B2B). Ignored for a buyer outside Germany. */
  readonly leitwegId?: string | undefined;
  /** Caller's own preference, when neither B2G-mandatory-XRechnung nor the plain default applies. */
  readonly preferredProfile?: EInvoiceProfileName | undefined;
}

export function selectProfile(options: SelectProfileOptions): EInvoiceProfileName {
  const { buyerCountry, leitwegId, preferredProfile } = options;

  if (buyerCountry === "DE") {
    if (leitwegId !== undefined) {
      return "XRECHNUNG";
    }
    return preferredProfile ?? "EN16931";
  }

  if (CLEARANCE_MODEL_COUNTRIES.has(buyerCountry)) {
    throw new UnsupportedCountryError(buyerCountry, "clearance-model");
  }

  if (
    EU_MEMBER_STATES.has(buyerCountry) ||
    EEA_NON_EU_COUNTRIES.has(buyerCountry) ||
    NON_EEA_ACCEPTED_COUNTRIES.has(buyerCountry)
  ) {
    return preferredProfile ?? "EN16931";
  }

  throw new UnsupportedCountryError(buyerCountry);
}
