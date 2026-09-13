/**
 * @normwerk/einvoice-model — generated EN 16931 types, code lists, and JSON
 * Schema (AGENTS.md §6: model layer, no logic, no I/O). See
 * tools/codegen/model/ for the generator and docs/sources.md for the
 * artifacts it's generated from.
 */
export * from "./generated/types.js";
export * from "./generated/codelists.js";
export type { Amount, IsoDate } from "./generated/primitives.js";
export { invoiceJsonSchema } from "./generated/json-schema.js";
export { validateModel, type ModelValidationResult } from "./validate.js";
