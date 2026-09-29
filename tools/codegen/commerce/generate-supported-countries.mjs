#!/usr/bin/env node
/**
 * T-116: the support matrix, generated from packages/einvoice-commerce/src/supported-jurisdictions.ts — the
 * constants the tax rules, the profile selection and the plugin's startup check read — so that no page claims
 * more than the code accepts. Writes docs/supported-countries.md and the table between the
 * `supported-countries` markers in README.md and in the plugin's README (the one npm shows), and fails when
 * the npm descriptions of einvoice-commerce and einvoice-medusa no longer name the buyers the constants allow.
 *
 * Country names and the clearance platforms' names are kept here, not in the package: a code the constants
 * gain without a name here stops this script, so the page is never generated with a bare code.
 *
 * Requires: `pnpm --filter @normwerk/einvoice-commerce build`. Deterministic: same constants in, same files out.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { format, resolveConfig } from "prettier";
import {
  CLEARANCE_MODEL_COUNTRIES,
  EEA_NON_EU_COUNTRIES,
  NON_EEA_ACCEPTED_COUNTRIES,
  SPECIAL_VAT_TERRITORY_RULES,
  SUPPORTED_SELLER_COUNTRIES,
  SUPPORTED_SINCE,
} from "../../../packages/einvoice-commerce/dist/supported-jurisdictions.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const PAGE_PATH = resolve(REPO_ROOT, "docs/supported-countries.md");
/** The repository's README and the plugin's — the one npm shows on the package page. */
const README_PATHS = ["README.md", "packages/einvoice-medusa/README.md"];
const START = "<!-- supported-countries:start -->";
const END = "<!-- supported-countries:end -->";

const COUNTRY_NAMES = {
  DE: "Germany",
  CH: "Switzerland",
  GB: "the UK",
  IS: "Iceland",
  IT: "Italy",
  LI: "Liechtenstein",
  NO: "Norway",
  PL: "Poland",
};
const CLEARANCE_PLATFORMS = { IT: "SDI", PL: "KSeF" };

function countryName(code) {
  const name = COUNTRY_NAMES[code];
  if (name === undefined) throw new Error(`No name for country ${code}: add it to COUNTRY_NAMES.`);
  return name;
}

function flag(code) {
  return String.fromCodePoint(...[...code].map((letter) => 0x1f1e6 + letter.charCodeAt(0) - 65));
}

/** "a", "a and b", "a, b and c" — or with "or". */
function list(items, conjunction = "and") {
  return items.length < 2
    ? items.join("")
    : `${items.slice(0, -1).join(", ")} ${conjunction} ${items.at(-1)}`;
}

function capitalize(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

if (SUPPORTED_SELLER_COUNTRIES.length !== 1 || SUPPORTED_SELLER_COUNTRIES[0] !== "DE") {
  throw new Error(
    "The seller countries changed: the buyer rows below are written for a seller in Germany. Rewrite them.",
  );
}
for (const code of CLEARANCE_MODEL_COUNTRIES) {
  if (CLEARANCE_PLATFORMS[code] === undefined) {
    throw new Error(`No clearance platform named for ${code}: add it to CLEARANCE_PLATFORMS.`);
  }
}

const seller = `${flag("DE")} ${countryName("DE")}`;
const clearance = [...CLEARANCE_MODEL_COUNTRIES].sort();
const clearanceNames = list(clearance.map(countryName));
const eea = [...EEA_NON_EU_COUNTRIES].sort().map(countryName);
const beyond = [...NON_EEA_ACCEPTED_COUNTRIES].sort();
const beyondNames = list(beyond.map(countryName));
const hybrid = "ZUGFeRD / Factur-X, `EN 16931` profile";
const delivery = "File: XML, or PDF/A-3b";

const rows = [
  [
    `${flag("DE")} Business or consumer in Germany`,
    `${hybrid} — or XRechnung 3.0, if you prefer it`,
  ],
  [`${flag("DE")} Public-sector buyer in Germany, with a Leitweg-ID`, "XRechnung 3.0"],
  [`${flag("EU")} Any other EU member state, except ${clearanceNames}; ${list(eea)} (EEA)`, hybrid],
  [`${beyond.map(flag).join(" ")} ${capitalize(beyondNames)}`, hybrid],
];

const matrix = [
  "| Seller — tax rules | Buyer | Document | Delivery | Since |",
  "| --- | --- | --- | --- | --- |",
  ...rows.map(
    ([buyer, document]) =>
      `| ${seller} | ${buyer} | ${document} | ${delivery} | ${SUPPORTED_SINCE} |`,
  ),
].join("\n");

const notSupported =
  `**Not supported:** ${clearance.map((code) => `${flag(code)} ${countryName(code)} (${CLEARANCE_PLATFORMS[code]})`).join(", ")} —\n` +
  "clearance platforms with an XML of their own, which no EN 16931 document can serve; out of scope. A buyer\n" +
  "anywhere else, and a seller outside Germany, are refused too.";

/** The buyers in one line — the npm descriptions carry it. */
const buyersLine = `Buyers in Germany (B2B, B2C, public sector), the EU/EEA except ${clearanceNames}, ${beyondNames}.`;

/** One row per territory, with every country code that names it (Northern Ireland: GB and XI). */
const territoryCodes = new Map();
for (const rule of SPECIAL_VAT_TERRITORY_RULES) {
  territoryCodes.set(rule.territory, [...(territoryCodes.get(rule.territory) ?? []), rule.country]);
}
const territories = [...territoryCodes].map(
  ([territory, codes]) =>
    `| ${codes.join(", ")} | ${capitalize(territory.name)} | ${territory.status} |`,
);
const goodsOnly = [...territoryCodes.keys()]
  .filter((territory) => territory.goodsOnly)
  .map((territory) => capitalize(territory.name));
const goodsOnlyNote =
  goodsOnly.length === 0
    ? ""
    : `\n${list(goodsOnly)} ${goodsOnly.length === 1 ? "is" : "are"} refused for goods only; a service there is taxed as in the\ncountry its code names.`;

const generatedNote =
  "<!-- Generated by tools/codegen/commerce/generate-supported-countries.mjs from " +
  "packages/einvoice-commerce/src/supported-jurisdictions.ts. Edit those, then run `pnpm codegen`. -->";

const page = `# Supported countries

Back to [\`docs/README.md\`](README.md).

${generatedNote}

What this release supports. The page is generated from the constants the tax rules and the plugin's startup
check read, so it cannot claim more than the code accepts.

## Seller and buyers

The seller is established in Germany: the VAT rules, rates and invoice requirements applied are German. A
seller established elsewhere stops the plugin at startup (\`UNSUPPORTED_SELLER_COUNTRY\`).

${matrix}

${notSupported}

A buyer in ${list(clearance.map(countryName), "or")} is refused as \`UNSUPPORTED_BUYER_COUNTRY_CLEARANCE\`, any other unsupported buyer as
\`UNSUPPORTED_BUYER_COUNTRY\`.

Which document a buyer receives, and why: [\`tax-semantics.md\`](tax-semantics.md).

## Territories with a VAT treatment of their own

These addresses carry an ordinary country code, but the territory's VAT treatment is not that country's. They
are recognised by postcode and refused (\`SPECIAL_VAT_TERRITORY\`) rather than invoiced with the wrong
category.${goodsOnlyNote}

| Country code | Territory | Why |
| --- | --- | --- |
${territories.join("\n")}

## Delivery

Every document is a file stored with the order: the CII XML, or a PDF/A-3b with the XML embedded when a PDF
is configured. It is downloaded from Medusa Admin, or by the customer through the Store API. Nothing is sent
through a network such as Peppol.

What comes next, country by country: the [country roadmap](../README.md#country-roadmap).
`;

const readmeBlock = `${START}\n${generatedNote}\n\n${matrix}\n\n${notSupported}\n${END}`;

async function formatted(path, text) {
  const config = await resolveConfig(path);
  return format(text, { ...config, filepath: path });
}

writeFileSync(PAGE_PATH, await formatted(PAGE_PATH, page));

for (const readmePath of README_PATHS) {
  const path = resolve(REPO_ROOT, readmePath);
  const readme = readFileSync(path, "utf8");
  const start = readme.indexOf(START);
  const end = readme.indexOf(END);
  if (start === -1 || end === -1 || end < start) {
    throw new Error(`${readmePath} has no ${START} … ${END} block to write the matrix into.`);
  }
  const next = readme.slice(0, start) + readmeBlock + readme.slice(end + END.length);
  writeFileSync(path, await formatted(path, next));
}

for (const pkg of ["einvoice-commerce", "einvoice-medusa"]) {
  const { description } = JSON.parse(
    readFileSync(resolve(REPO_ROOT, `packages/${pkg}/package.json`), "utf8"),
  );
  if (!description.includes(buyersLine)) {
    throw new Error(`packages/${pkg}/package.json: the description must include "${buyersLine}"`);
  }
}

console.log(
  `Wrote docs/supported-countries.md and the matrix in both READMEs: ${rows.length} buyer rows, ` +
    `${territories.length} territories; npm descriptions name the same buyers`,
);
