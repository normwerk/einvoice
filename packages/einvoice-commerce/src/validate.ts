/**
 * T-060: structural-only validation of a `CommerceInvoiceInput` against the
 * generated JSON Schema (`generated/json-schema.ts`) — same split as
 * `@normwerk/einvoice-model`'s own `validateModel()`: this checks shape
 * (right fields, right types, right enums), never business rules or tax
 * semantics (`decideVatCategory`/`docs/tax-semantics.md` own that; a green
 * result here says nothing about whether the resolved VAT category will be
 * correct). Exists for exactly the caller ADR-003 names: someone building
 * `CommerceInvoiceInput` by hand or from a non-TypeScript codebase, who
 * never goes through this package's `.d.ts` files at all.
 */
import Ajv, { type ErrorObject } from "ajv";
import addFormats from "ajv-formats";
import { commerceInvoiceInputJsonSchema } from "./generated/json-schema.js";

export interface CommerceInvoiceInputValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const validateFn = ajv.compile(commerceInvoiceInputJsonSchema);

/**
 * Structural-only check against the generated JSON Schema. Does not know
 * about EN 16931 business rules, XRechnung's own additions (BR-DE-*), or
 * this package's own extra requirements (a Leitweg-ID's checksum, a
 * category-K document's delivery block) — `buildInvoice` enforces those
 * itself, deliberately layered after this structural gate rather than
 * folded into the schema (AGENTS.md §8.5: conformance level, not blurred).
 */
export function validateCommerceInvoiceInput(input: unknown): CommerceInvoiceInputValidationResult {
  const valid = validateFn(input) as boolean;
  return {
    valid,
    errors: valid ? [] : (validateFn.errors ?? []).map(formatError),
  };
}

function formatError(error: ErrorObject): string {
  return `${error.instancePath || "/"} ${error.message ?? "invalid"}`;
}
