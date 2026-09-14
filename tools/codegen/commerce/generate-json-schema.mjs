#!/usr/bin/env node
/**
 * Generates packages/einvoice-commerce/src/generated/json-schema.ts from
 * packages/einvoice-commerce/src/types.ts's `CommerceInvoiceInput` (and
 * everything it references) via `ts-json-schema-generator`, which reads
 * the TypeScript AST directly — the schema can never drift from the type
 * declarations because it is derived from them, not hand-duplicated
 * (AGENTS.md §9's spirit: generated from a single source of truth. Unlike
 * `codegen:model`, that source of truth here is this repo's own contract
 * type fixed by ADR-003, not an external spec artifact — there is nothing
 * external to cross-check against).
 *
 * Deterministic: same types.ts in, byte-identical file out (sortProps
 * keeps property order stable regardless of TS's internal ordering).
 *
 * To change: edit packages/einvoice-commerce/src/types.ts, then re-run
 * `pnpm --filter @normwerk/einvoice-commerce codegen` (or `pnpm codegen:commerce`
 * from the repo root).
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createGenerator } from "ts-json-schema-generator";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../..");
const PACKAGE_DIR = resolve(REPO_ROOT, "packages/einvoice-commerce");
const TYPES_FILE = resolve(PACKAGE_DIR, "src/types.ts");
const TSCONFIG = resolve(PACKAGE_DIR, "tsconfig.json");
const OUT_FILE = resolve(PACKAGE_DIR, "src/generated/json-schema.ts");

const generator = createGenerator({
  path: TYPES_FILE,
  tsconfig: TSCONFIG,
  type: "CommerceInvoiceInput",
  expose: "export",
  topRef: false,
  jsDoc: "none",
  sortProps: true,
  additionalProperties: false,
  skipTypeCheck: false,
});

const schema = generator.createSchema("CommerceInvoiceInput");

// ts-json-schema-generator's own draft — this tool emits draft-07 (a plain
// "definitions" map, not 2020-12's "$defs"), kept as-is rather than
// relabelled: claiming a different $schema than the structure actually
// matches would be worse than the mismatch with @normwerk/einvoice-model's
// separately hand-authored 2020-12 schema. Pin our own $id/title/$comment
// (topRef: false already keeps the root free of a wrapping $ref).
const { $schema, ...rest } = schema;
delete rest.$ref;
const orderedSchema = {
  $schema,
  $comment: "GENERATED — see tools/codegen/commerce/generate-json-schema.mjs",
  $id: "https://normwerk.dev/schema/einvoice-commerce/commerce-invoice-input.json",
  title: "CommerceInvoiceInput (ADR-003)",
  ...rest,
};

const HEADER = `/**
 * GENERATED FILE — do not hand-edit (AGENTS.md §9).
 *
 * Generator: tools/codegen/commerce/generate-json-schema.mjs
 * Source: packages/einvoice-commerce/src/types.ts's \`CommerceInvoiceInput\`
 * (ADR-003, docs/adr/003-commerce-invoice-input.md) via ts-json-schema-generator
 * — read directly from the TypeScript AST, not a hand-duplicated definition.
 * To change: edit types.ts, then re-run \`pnpm codegen:commerce\` from the repo root.
 */
`;

const body = `export const commerceInvoiceInputJsonSchema = ${JSON.stringify(orderedSchema, null, 2)} as const;\n`;

writeFileSync(OUT_FILE, HEADER + body, "utf-8");
console.log(`Wrote ${OUT_FILE}`);
