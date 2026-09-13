/**
 * Hand-written (ADR-002: business/validation logic is not generated).
 * Structural-only validation against the generated JSON Schema — no
 * business rules, no tax semantics (those live in `einvoice-commerce` and
 * `docs/tax-semantics.md`; a green `validateModel()` result says nothing
 * about whether the VAT category is the *correct* one, per AGENTS.md §8.5).
 */
import Ajv2020, { type ErrorObject } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { invoiceJsonSchema } from "./generated/json-schema.js";

export interface ModelValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validateFn = ajv.compile(invoiceJsonSchema);

/**
 * Structural-only check against the generated JSON Schema. Does not know
 * about EN 16931 business rules (BR-*) or tax semantics — see
 * `AGENTS.md` §8 for what each conformance level actually covers.
 */
export function validateModel(invoice: unknown): ModelValidationResult {
  const valid = validateFn(invoice) as boolean;
  return {
    valid,
    errors: valid ? [] : (validateFn.errors ?? []).map(formatError),
  };
}

function formatError(error: ErrorObject): string {
  return `${error.instancePath || "/"} ${error.message ?? "invalid"}`;
}
