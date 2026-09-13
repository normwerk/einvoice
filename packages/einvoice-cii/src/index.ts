/**
 * `@normwerk/einvoice-cii` — CII D16B serializer (plan-v0.1 §4.2, T-020).
 *
 * `serializeCii()` is a pure function: `Invoice` in, XML text out, no I/O.
 * Element order and paths come from `generated/plan.ts`; the interpreter
 * that walks it (`serialize.ts`) is hand-written and doesn't change per
 * profile (ADR-004).
 */
import type { Invoice } from "@normwerk/einvoice-model";
import { invoicePlan } from "./generated/plan.js";
import { serializeWithPlan } from "./serialize.js";

/**
 * Profiles this package can target. Only the base EN 16931 CII binding is
 * implemented so far — XRechnung's own customization-ID/BR-DE-* prechecks
 * (`profileViolations` below) are T-021, not yet written.
 */
export type CiiProfile = "en16931-cii" | "xrechnung-3.0-cii";

export interface SerializeOptions {
  readonly profile: CiiProfile;
  /** `false` (default) for byte-stable output; a number of spaces to pretty-print for human debugging only (ADR-004: never compared byte-for-byte). */
  readonly indent?: false | number;
}

export interface ProfileViolation {
  readonly rule: string;
  readonly message: string;
}

export interface SerializeResult {
  readonly xml: string;
  /** Profile-specific prechecks found before serialization (T-021 — always empty for now). */
  readonly profileViolations: readonly ProfileViolation[];
}

export function serializeCii(invoice: Invoice, options: SerializeOptions): SerializeResult {
  void options; // profile prechecks land in T-021; base CII binding is profile-agnostic so far.
  return { xml: serializeWithPlan(invoicePlan, invoice), profileViolations: [] };
}

export { invoicePlan } from "./generated/plan.js";
export { serializeWithPlan } from "./serialize.js";
export type { PlanNode, QName } from "./plan-types.js";
