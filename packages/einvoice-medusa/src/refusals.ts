/**
 * P-66: documents the plugin did not issue, recorded instead of thrown. Two kinds end up here, both before a
 * document number is taken:
 *
 * - the invoice disagrees with what Medusa charged (P-63, `mapping/charged-reconciliation.ts`) — the code is
 *   the block's, the details its amounts;
 * - the document was refused: `buildInvoice` could not decide or build it (a VAT-ID VIES did not confirm, a
 *   fact missing, a rate it cannot invoice), the order could not be mapped, or the VAT-ID check itself failed.
 *   The code is the error's class name until errors carry codes of
 *   their own (T-077); the details hold its message.
 *
 * A thrown error used to reach only the log, and the event that would have issued the document does not
 * come again — the order silently had no invoice. A refusal is shown in the admin widget and retried from
 * there (`POST /admin/orders/:id/einvoice/refusals/:refusalId/retry`); `details.event` names what a credit
 * note's retry redelivers. The log line carries the code and the message, never the document.
 */
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import type { MedusaContainer } from "@medusajs/framework";
import type EinvoiceModuleService from "./modules/einvoice/service.js";
import type { EinvoiceDocumentType, EinvoiceRefusalRecord } from "./modules/einvoice/service.js";
import {
  describeChargedReconciliation,
  type InvoiceBlock,
} from "./mapping/charged-reconciliation.js";

/** What a credit note's retry redelivers: the refund's payment, or the cancellation. */
export type CreditNoteTrigger =
  | { readonly event: "payment.refunded"; readonly paymentId: string }
  | { readonly event: "order.canceled" };

export interface RefusalTarget {
  readonly type: EinvoiceDocumentType;
  readonly orderId: string;
  /** The key the document would carry: a fulfillment id, a refund id, or the cancellation key. */
  readonly idempotencyKey: string;
  readonly trigger?: CreditNoteTrigger;
}

const RECONCILIATION_CODES: ReadonlySet<string> = new Set([
  "INVOICE_VAT_ABOVE_CHARGED",
  "INVOICE_TOTAL_MISMATCH",
  "CHARGED_TOTALS_MISSING",
]);

/** The merchant-facing explanation of a refusal — the admin widget and the log both show it. */
export function describeRefusal(refusal: Pick<EinvoiceRefusalRecord, "code" | "details">): string {
  if (RECONCILIATION_CODES.has(refusal.code)) {
    return describeChargedReconciliation({
      ...refusal.details,
      code: refusal.code,
    } as unknown as InvoiceBlock);
  }
  const message = refusal.details["message"];
  return typeof message === "string" && message !== ""
    ? `Not issued: ${message}`
    : `Not issued [${refusal.code}].`;
}

function documentLabel(target: RefusalTarget): string {
  return target.type === "invoice"
    ? `invoice for fulfillment ${target.idempotencyKey}`
    : `credit note for ${target.idempotencyKey}`;
}

/** Records `error` as the reason the document for `target` was not issued, and logs it at warn level. */
export async function recordRefusalOfError(
  container: MedusaContainer,
  einvoiceService: EinvoiceModuleService,
  target: RefusalTarget,
  error: unknown,
): Promise<{ readonly refusal: EinvoiceRefusalRecord; readonly message: string }> {
  const code = error instanceof Error && error.name !== "" ? error.name : "Error";
  const ruleId = (error as { readonly ruleId?: unknown } | null)?.ruleId;
  const details: Record<string, unknown> = {
    message: error instanceof Error ? error.message : String(error),
    ...(typeof ruleId === "string" ? { ruleId } : {}),
    ...target.trigger,
  };
  const refusal = await einvoiceService.recordRefusal({
    type: target.type,
    orderId: target.orderId,
    idempotencyKey: target.idempotencyKey,
    code,
    details,
  });
  const message = describeRefusal({ code, details });
  container
    .resolve(ContainerRegistrationKeys.LOGGER)
    .warn(`einvoice: order ${target.orderId}: ${documentLabel(target)} — ${message} [${code}]`);
  return { refusal, message };
}
