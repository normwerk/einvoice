/**
 * T-214: a refusal or a notice as the dry-run report states it — the code, the sentence the code's doc comment
 * opens with (`generated/error-reasons.ts`), its entry in the error reference, and the buyer's country or the
 * notice's cause where they explain it. Never the error's message or the amounts of a block or a notice: those
 * belong to one buyer's order (D-08).
 */
import type { Finding } from "@normwerk/einvoice-conformance" with {
  "resolution-mode": "import",
};
import { errorCodeOf, errorDocsUrl } from "../errors.js";
import { ERROR_REASONS } from "../generated/error-reasons.js";
import type { InvoiceBlock, InvoiceNotice } from "../mapping/charged-reconciliation.js";

function reasonOf(code: string): string {
  return ERROR_REASONS[code] ?? "The error reference explains this code.";
}

/** A refusal the plan caught: an error with its code. */
export function refusalFinding(error: unknown): Finding {
  const { code, docsUrl } = errorCodeOf(error);
  const { countryCode } = (error ?? {}) as { readonly countryCode?: unknown };
  return {
    code,
    reason: reasonOf(code),
    docsUrl,
    ...(typeof countryCode === "string" ? { country: countryCode } : {}),
  };
}

/** The invoice disagrees with what Medusa charged. */
export function blockFinding(block: InvoiceBlock): Finding {
  return { code: block.code, reason: reasonOf(block.code), docsUrl: errorDocsUrl(block.code) };
}

export function noticeFinding(notice: InvoiceNotice): Finding {
  return {
    code: notice.code,
    reason: reasonOf(notice.code),
    docsUrl: errorDocsUrl(notice.code),
    ...(notice.cause === null ? {} : { cause: notice.cause }),
  };
}
