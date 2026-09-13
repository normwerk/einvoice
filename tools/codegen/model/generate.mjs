#!/usr/bin/env node
/**
 * Generates packages/einvoice-model/src/generated/*.ts from:
 *  - tools/codegen/model/terms.mjs (curated BT/BG list, self-documenting provenance)
 *  - artifacts/cii-d16b/schematron/*.sch (vendored, EUPL-1.2 — cross-check + codelists)
 *
 * Every `verified: "extraction"` term in terms.mjs is checked against the
 * artifact text itself before anything is emitted — a name that doesn't
 * appear in the source is a hard error, not a warning (ADR-002: generated
 * code traces back to an artifact, never to memory).
 *
 * Deterministic: same terms.mjs + same artifacts => byte-identical output.
 * Run twice on a clean tree and diff to confirm (plan-v0.1 W4 acceptance).
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { terms } from "./terms.mjs";
import { extractFromFiles } from "./extract-term-names.mjs";
import { extractCodelistsFromFile } from "./extract-codelists.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../..");
const ARTIFACTS = resolve(REPO_ROOT, "artifacts/cii-d16b/schematron");
const OUT_DIR = resolve(REPO_ROOT, "packages/einvoice-model/src/generated");

const SOURCE_FILES = {
  validation: resolve(ARTIFACTS, "EN16931-CII-validation-preprocessed.sch"),
  codes: resolve(ARTIFACTS, "EN16931-CII-codes.sch"),
};

const HEADER = `/**
 * GENERATED FILE — do not hand-edit (AGENTS.md §9).
 *
 * Generator: tools/codegen/model/generate.mjs
 * Source artifacts (see artifacts/MANIFEST.json for hashes):
 *   - artifacts/cii-d16b/schematron/EN16931-CII-validation-preprocessed.sch (EUPL-1.2)
 *   - artifacts/cii-d16b/schematron/EN16931-CII-codes.sch (EUPL-1.2)
 * To change: edit tools/codegen/model/terms.mjs or the artifact, then
 * re-run \`pnpm codegen:model\` from the repo root.
 */
`;

function assertVerifiedAgainstArtifact() {
  const extracted = extractFromFiles(Object.values(SOURCE_FILES));
  const failures = [];
  for (const term of terms) {
    if (term.verified !== "extraction") continue;
    const candidates = extracted.get(term.id);
    if (!candidates || !candidates.has(term.name)) {
      failures.push(
        `${term.id} claims name "${term.name}" (verified: "extraction") but that exact phrase was not ` +
          `found next to ${term.id} in the vendored Schematron. Candidates found: ` +
          `${candidates ? [...candidates.keys()].join(" | ") : "(none)"}`,
      );
    }
  }
  if (failures.length > 0) {
    throw new Error(
      `codegen refused: ${failures.length} term(s) in terms.mjs don't match the artifact —\n` +
        failures.map((f) => `  - ${f}`).join("\n"),
    );
  }
}

function tsComment(term) {
  const flag =
    term.verified === "extraction"
      ? ""
      : " (name not independently quoted in our extraction — see terms.mjs)";
  return `/** ${term.id} ${term.name}${flag} */`;
}

/** Turn "Seller VAT identifier" style names into a camelCase field name, biased by BT id for stability. */
const FIELD_NAME_OVERRIDES = {
  "BT-1": "number",
  "BT-2": "issueDate",
  "BT-3": "typeCode",
  "BT-5": "currencyCode",
  "BT-6": "taxCurrencyCode",
  "BT-7": "taxPointDate",
  "BT-8": "taxPointDateCode",
  "BT-24": "specificationIdentifier",
  "BT-10": "buyerReference",
  "BG-3": "precedingInvoiceReferences",
  "BT-25": "invoiceNumber",
  "BT-26": "issueDate",
  "BG-4": "seller",
  "BT-27": "name",
  "BT-29": "identifier",
  "BT-30": "legalRegistrationIdentifier",
  "BT-31": "vatIdentifier",
  "BT-32": "taxRegistrationIdentifier",
  "BT-40": "countryCode",
  "BG-11": "sellerTaxRepresentative",
  "BT-63": "vatIdentifier",
  "BT-69": "countryCode",
  "BG-7": "buyer",
  "BT-44": "name",
  "BT-47": "legalRegistrationIdentifier",
  "BT-48": "vatIdentifier",
  "BT-55": "countryCode",
  "BG-13": "delivery",
  "BT-72": "actualDeliveryDate",
  "BT-80": "deliverToCountryCode",
  "BG-14": "invoicingPeriod",
  "BT-73": "startDate",
  "BT-74": "endDate",
  "BG-16": "paymentInstructions",
  "BT-81": "meansTypeCode",
  "BT-84": "accountIdentifier",
  "BG-20": "documentLevelAllowances",
  "BG-21": "documentLevelCharges",
  "BT-92": "amount",
  "BT-93": "baseAmount",
  "BT-95": "vatCategoryCode",
  "BT-96": "vatRate",
  "BT-97": "reason",
  "BT-98": "reasonCode",
  "BT-99": "amount",
  "BT-100": "baseAmount",
  "BT-102": "vatCategoryCode",
  "BT-103": "vatRate",
  "BT-104": "reason",
  "BT-105": "reasonCode",
  "BG-22": "totals",
  "BT-106": "sumOfLineNetAmounts",
  "BT-107": "sumOfAllowances",
  "BT-108": "sumOfCharges",
  "BT-109": "totalAmountWithoutVat",
  "BT-110": "totalVatAmount",
  "BT-111": "totalVatAmountInAccountingCurrency",
  "BT-112": "totalAmountWithVat",
  "BT-113": "paidAmount",
  "BT-114": "roundingAmount",
  "BT-115": "amountDueForPayment",
  "BG-23": "vatBreakdown",
  "BT-116": "taxableAmount",
  "BT-117": "taxAmount",
  "BT-118": "categoryCode",
  "BT-119": "rate",
  "BT-120": "exemptionReasonText",
  "BT-121": "exemptionReasonCode",
  "BG-24": "additionalSupportingDocuments",
  "BT-122": "reference",
  "BG-25": "lines",
  "BT-126": "identifier",
  "BT-129": "quantity",
  "BT-130": "unitCode",
  "BT-131": "netAmount",
  "BT-146": "netPrice",
  "BT-153": "itemName",
  "BG-26": "invoicingPeriod",
  "BT-134": "startDate",
  "BT-135": "endDate",
  "BG-27": "allowances",
  "BT-136": "amount",
  "BT-137": "baseAmount",
  "BT-139": "reason",
  "BT-140": "reasonCode",
  "BG-28": "charges",
  "BT-141": "amount",
  "BT-142": "baseAmount",
  "BT-144": "reason",
  "BT-145": "reasonCode",
  "BG-30": "vat",
  "BT-151": "categoryCode",
  "BT-152": "rate",
  "BG-32": "itemAttributes",
  "BT-160": "name",
  "BT-161": "value",
};

function generateInterfaces() {
  /** @type {Map<string, { members: string; bg?: TermDef }>} */
  const groups = new Map();
  // BG terms define nested interfaces; BT terms are fields on their group.
  for (const term of terms) {
    if (term.kind === "BG") {
      if (!groups.has(term.tsType)) groups.set(term.tsType, { members: "" });
    }
  }
  groups.set("Invoice", { members: "" }); // root, not itself a BG

  for (const term of terms) {
    const fieldName = FIELD_NAME_OVERRIDES[term.id];
    if (!fieldName)
      throw new Error(`No field name mapping for ${term.id} — add one to FIELD_NAME_OVERRIDES`);
    const target = groups.get(term.group);
    if (!target) throw new Error(`Unknown group "${term.group}" for ${term.id}`);
    const tsType = term.kind === "BG" && term.repeats ? `readonly ${term.tsType}[]` : term.tsType;
    const optional = term.required ? "" : "?";
    target.members += `  ${tsComment(term)}\n  readonly ${fieldName}${optional}: ${tsType};\n`;
  }

  let out = HEADER;
  out += `import type { Amount, IsoDate } from "./primitives";\n`;
  out += `import type {\n  CountryCode,\n  CurrencyCode,\n  InvoiceTypeCode,\n  PaymentMeansCode,\n  UnitCode,\n  VatCategoryCode,\n  VatexCode,\n} from "./codelists";\n\n`;

  // Emit Invoice root first, then the rest alphabetically for stable diffs.
  out += `/** EN 16931 invoice or credit note, in model form. Amounts are decimal strings (ADR-004) — never a JS number. */\n`;
  out += `export interface Invoice {\n${groups.get("Invoice").members}}\n\n`;
  const rest = [...groups.keys()].filter((k) => k !== "Invoice").sort();
  for (const name of rest) {
    const bgTerm = terms.find((t) => t.kind === "BG" && t.tsType === name);
    const doc = bgTerm ? `/** ${bgTerm.id} ${bgTerm.name} */\n` : "";
    out += `${doc}export interface ${name} {\n${groups.get(name).members}}\n\n`;
  }
  return out;
}

function tsUnion(name, codes, description) {
  const literal = codes.map((c) => `  | "${c}"`).join("\n");
  return `/** ${description} */\nexport type ${name} =\n${literal};\n\n`;
}

function generateCodelists() {
  const lists = extractCodelistsFromFile(SOURCE_FILES.codes);
  let out = HEADER;
  out += tsUnion(
    "VatCategoryCode",
    lists.get("BR-CL-17").codes,
    "UNCL 5305 VAT category code (BT-118/BT-95/BT-102/BT-151), restricted to the codes EN 16931 CII actually allows.",
  );
  out += tsUnion(
    "VatexCode",
    lists.get("BR-CL-22").codes,
    "CEF VATEX VAT exemption reason code (BT-121).",
  );
  out += tsUnion(
    "CurrencyCode",
    lists.get("BR-CL-04").codes,
    "ISO 4217 alpha-3 currency code (BT-5/BT-6).",
  );
  out += tsUnion("CountryCode", lists.get("BR-CL-14").codes, "ISO 3166-1 alpha-2 country code.");
  out += tsUnion(
    "InvoiceTypeCode",
    lists.get("BR-CL-01").codes,
    "UNTDID 1001 document type code, restricted to the invoice/credit-note subset EN 16931 allows (BT-3).",
  );
  out += tsUnion(
    "PaymentMeansCode",
    lists.get("BR-CL-16").codes,
    "UNTDID 4461 payment means code (BT-81).",
  );
  out += `/**\n * UN/ECE Recommendation 20 (+ Rec 21 extension) unit of measure code (BT-130).\n`;
  out += ` * Kept as \`string\`, not a literal union — the codelist has ${lists.get("BR-CL-23").codes.length} entries,\n`;
  out += ` * too many to usefully browse in an editor tooltip. The full list is still enforced\n`;
  out += ` * at runtime by \`validateModel()\`'s JSON Schema (jsonSchema.ts), generated from the same artifact.\n */\n`;
  out += `export type UnitCode = string;\n`;
  return { code: out, lists };
}

function generateJsonSchema(lists) {
  const schema = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $comment: "GENERATED — see packages/einvoice-model/src/generated/README.md",
    $id: "https://normwerk.dev/schema/einvoice-model/invoice.json",
    title: "EN 16931 Invoice (model form)",
    type: "object",
    properties: {
      number: { type: "string" },
      issueDate: { type: "string", format: "date" },
      typeCode: { type: "string", enum: lists.get("BR-CL-01").codes },
      currencyCode: { type: "string", enum: lists.get("BR-CL-04").codes },
      specificationIdentifier: { type: "string" },
      vatBreakdown: {
        type: "array",
        minItems: 1,
        items: {
          type: "object",
          properties: {
            taxableAmount: { type: "string" },
            taxAmount: { type: "string" },
            categoryCode: { type: "string", enum: lists.get("BR-CL-17").codes },
            rate: { type: "string" },
            exemptionReasonText: { type: "string" },
            exemptionReasonCode: { type: "string", enum: lists.get("BR-CL-22").codes },
          },
          required: ["taxableAmount", "taxAmount", "categoryCode"],
        },
      },
      lines: {
        type: "array",
        minItems: 1,
        items: {
          type: "object",
          properties: {
            identifier: { type: "string" },
            quantity: { type: "string" },
            unitCode: { type: "string" },
            netAmount: { type: "string" },
            netPrice: { type: "string" },
            itemName: { type: "string" },
            vat: {
              type: "object",
              properties: {
                categoryCode: { type: "string", enum: lists.get("BR-CL-17").codes },
                rate: { type: "string" },
              },
              required: ["categoryCode"],
            },
          },
          required: [
            "identifier",
            "quantity",
            "unitCode",
            "netAmount",
            "netPrice",
            "itemName",
            "vat",
          ],
        },
      },
      totals: {
        type: "object",
        properties: {
          sumOfLineNetAmounts: { type: "string" },
          totalAmountWithoutVat: { type: "string" },
          totalAmountWithVat: { type: "string" },
          amountDueForPayment: { type: "string" },
        },
        required: [
          "sumOfLineNetAmounts",
          "totalAmountWithoutVat",
          "totalAmountWithVat",
          "amountDueForPayment",
        ],
      },
    },
    required: [
      "number",
      "issueDate",
      "typeCode",
      "currencyCode",
      "specificationIdentifier",
      "vatBreakdown",
      "lines",
      "totals",
    ],
    additionalProperties: true,
    $comment2:
      "additionalProperties: true deliberately — this schema covers the core scenario fields " +
      "checked by scenario fixtures (docs/tax-semantics.md); it is not yet a full structural " +
      "schema for every field in generated/types.ts (T-011 continuation).",
  };
  return HEADER + `export const invoiceJsonSchema = ${JSON.stringify(schema, null, 2)} as const;\n`;
}

function generatePrimitives() {
  return (
    HEADER +
    `/** Decimal amount as text — never a JS number (ADR-004: BR-CO-* rules compare amounts exactly). */\n` +
    `export type Amount = string;\n\n` +
    `/** ISO 8601 calendar date, "YYYY-MM-DD". Syntax-specific formatting (e.g. CII's "102" = YYYYMMDD) is a serializer concern, not a model concern. */\n` +
    `export type IsoDate = string;\n`
  );
}

function main() {
  assertVerifiedAgainstArtifact();
  mkdirSync(OUT_DIR, { recursive: true });

  const { code: codelistsCode, lists } = generateCodelists();
  writeFileSync(resolve(OUT_DIR, "primitives.ts"), generatePrimitives());
  writeFileSync(resolve(OUT_DIR, "codelists.ts"), codelistsCode);
  writeFileSync(resolve(OUT_DIR, "types.ts"), generateInterfaces());
  writeFileSync(resolve(OUT_DIR, "json-schema.ts"), generateJsonSchema(lists));

  console.log(`Generated ${terms.length} terms into ${OUT_DIR}`);
}

main();
