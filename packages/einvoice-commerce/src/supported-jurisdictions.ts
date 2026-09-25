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

/** A territory whose VAT treatment is not its country code's. */
export interface SpecialVatTerritory {
  readonly name: string;
  /** Why its VAT treatment differs, in one clause. */
  readonly status: string;
  /** Northern Ireland: inside the EU VAT area for goods only — for services it is the UK. */
  readonly goodsOnly: boolean;
}

interface SpecialVatTerritoryRule {
  readonly country: CountryCode;
  /** Tested against the postcode without spaces, in upper case, and — for numeric postcodes — without a
   * leading country prefix such as `AX-` or `E-`. Absent: the whole country code is the territory. */
  readonly postcode?: RegExp;
  readonly numeric: boolean;
  readonly territory: SpecialVatTerritory;
}

const OUTSIDE_EU_VAT_AREA = "outside the EU VAT area although part of an EU member state";

function outside(name: string): SpecialVatTerritory {
  return { name, status: OUTSIDE_EU_VAT_AREA, goodsOnly: false };
}

const NORTHERN_IRELAND: SpecialVatTerritory = {
  name: "Northern Ireland",
  status: "inside the EU VAT area for goods under the Windsor Framework although part of the UK",
  goodsOnly: true,
};

/**
 * T-195: territories an order names by an ordinary country code whose VAT treatment differs from that code's —
 * the VAT Directive's Art. 6 exclusions (§1 Abs. 2 UStG for Heligoland and Büsingen) and Northern Ireland.
 * Which territories: the European Commission's territorial-scope table
 * (https://taxation-customs.ec.europa.eu/territorial-scope_en, "VAT rules apply": no; Northern Ireland "VAT
 * (for goods only)"), fetched 2026-09-25. Recognised by postcode, since a shop sends the Canary Islands as ES
 * and Northern Ireland as GB. Postcodes, fetched 2026-09-25: Spanish provinces 35/38 (Las Palmas, Santa Cruz
 * de Tenerife), 51 (Ceuta), 52 (Melilla) — en.wikipedia.org "Postal codes in Spain"; the BT area covers all of
 * Northern Ireland — en.wikipedia.org "BT postcode area"; Heligoland 27498, Büsingen 78266 — de.wikipedia.org;
 * Livigno 23041, Campione d'Italia 22061 — it.wikipedia.org; Åland 22xxx under the Finnish system — upu.int
 * addressing sheet for the Åland Islands (AX-22100 Mariehamn); Mount Athos 63086 Karyes, 63087 Dafni; French
 * overseas departments and collectivities 97xxx, overseas territories 98xxx except Monaco's 980xx (Monaco is
 * French territory for VAT) — fr.wikipedia.org "Code postal en France". Not recognisable by postcode: the
 * Italian waters of Lake Lugano. A territory with its own ISO code (AX, GP, RE, …) is already outside the EU
 * set and treated as a third country.
 */
const SPECIAL_VAT_TERRITORY_RULES: readonly SpecialVatTerritoryRule[] = [
  { country: "DE", postcode: /^27498$/, numeric: true, territory: outside("Heligoland") },
  {
    country: "DE",
    postcode: /^78266$/,
    numeric: true,
    territory: outside("Büsingen am Hochrhein"),
  },
  {
    country: "ES",
    postcode: /^3[58]\d{3}$/,
    numeric: true,
    territory: outside("the Canary Islands"),
  },
  { country: "ES", postcode: /^51\d{3}$/, numeric: true, territory: outside("Ceuta") },
  { country: "ES", postcode: /^52\d{3}$/, numeric: true, territory: outside("Melilla") },
  { country: "FI", postcode: /^22\d{3}$/, numeric: true, territory: outside("the Åland Islands") },
  {
    country: "FR",
    postcode: /^(97\d|98[1-9])\d{2}$/,
    numeric: true,
    territory: outside("a French overseas department or territory"),
  },
  { country: "GR", postcode: /^6308[67]$/, numeric: true, territory: outside("Mount Athos") },
  { country: "IT", postcode: /^23041$/, numeric: true, territory: outside("Livigno") },
  { country: "IT", postcode: /^22061$/, numeric: true, territory: outside("Campione d'Italia") },
  { country: "GB", postcode: /^BT\d/, numeric: false, territory: NORTHERN_IRELAND },
  { country: "XI", numeric: false, territory: NORTHERN_IRELAND },
];

/** The special VAT territory an address is in, if any — see `SPECIAL_VAT_TERRITORY_RULES`. */
export function specialVatTerritory(
  country: CountryCode,
  postCode: string | undefined,
): SpecialVatTerritory | undefined {
  const compact = (postCode ?? "").replace(/\s+/g, "").toUpperCase();
  const digits = compact.replace(/^[A-Z]{1,3}-?(?=\d)/, "");
  return SPECIAL_VAT_TERRITORY_RULES.find(
    (rule) =>
      rule.country === country &&
      (rule.postcode === undefined || rule.postcode.test(rule.numeric ? digits : compact)),
  )?.territory;
}

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
