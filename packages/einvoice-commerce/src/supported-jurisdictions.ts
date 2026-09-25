/**
 * T-077: what this release supports, in one place — read by the tax rules' seller check
 * (`decideVatCategory`), the profile selection (`selectProfile`), and the adapters' startup check and
 * status. Each entry says since which release it is supported.
 */
import type { CountryCode } from "@normwerk/einvoice-model";

/** Where the seller may be established: the VAT rules, rates and invoice requirements applied are German. */
export const SUPPORTED_SELLER_COUNTRIES: readonly CountryCode[] = ["DE"];

/** The release the support below arrived in. */
export const SUPPORTED_SINCE = "0.1.0";

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

/**
 * EEA member states that are not also EU members (ISO 3166-1 alpha-2) — Iceland, Liechtenstein, Norway.
 * Verified directly against https://www.efta.int/eea ("the three EEA EFTA States — Iceland, Liechtenstein
 * and Norway"), fetched 2026-09-19 — not assumed from memory.
 */
export const EEA_NON_EU_COUNTRIES: ReadonlySet<CountryCode> = new Set(["IS", "LI", "NO"]);

/**
 * Countries outside the EU/EEA that this package still accepts an EN 16931 hybrid document for (T-066):
 * Switzerland and the UK. Not an EEA-membership fact — a deliberate v0.1 acceptance decision (neither
 * country runs a clearance system of its own that would reject a Factur-X/ZUGFeRD hybrid PDF; see
 * `README.md`'s own country-roadmap table, "Swiss / UK buyer of a German seller"). Kept as its own named
 * set rather than folded into the EEA one so the two provenances stay distinguishable.
 */
export const NON_EEA_ACCEPTED_COUNTRIES: ReadonlySet<CountryCode> = new Set(["CH", "GB"]);

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
export const CLEARANCE_MODEL_COUNTRIES: ReadonlySet<CountryCode> = new Set(["IT", "PL"]);

/** How a buyer's country is served: an EN 16931 document, or not at all — a clearance platform of its own, or
 * not supported yet. A German public-sector buyer is an EN 16931 buyer too; what routes it to XRechnung is
 * the Leitweg-ID it declares, not its country. */
export type BuyerCountrySupport = "en16931" | "clearance-unsupported" | "unsupported";

export function buyerCountrySupport(country: CountryCode): BuyerCountrySupport {
  if (CLEARANCE_MODEL_COUNTRIES.has(country)) return "clearance-unsupported";
  return EU_MEMBER_STATES.has(country) ||
    EEA_NON_EU_COUNTRIES.has(country) ||
    NON_EEA_ACCEPTED_COUNTRIES.has(country)
    ? "en16931"
    : "unsupported";
}

/**
 * One line on what this release supports, for a status display — the seller, the documents, the buyers,
 * what is refused and how documents are delivered.
 */
export function describeSupport(): string {
  const clearance = [...CLEARANCE_MODEL_COUNTRIES].sort().join(", ");
  return (
    `seller ${SUPPORTED_SELLER_COUNTRIES.join(", ")} · documents: XRechnung 3.0, ZUGFeRD / Factur-X ` +
    `(EN 16931) · buyers: Germany, EU/EEA except ${clearance}, Switzerland, UK (EN 16931); German public ` +
    `sector with a Leitweg-ID (XRechnung) · not supported: ${clearance} (clearance platforms) · delivery: ` +
    `file (XML, PDF/A-3) · since ${SUPPORTED_SINCE}`
  );
}
