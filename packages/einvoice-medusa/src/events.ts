/**
 * P-71 (M-047): the plugin's events, for a shop's own code — send the invoice to the buyer, hand it to
 * accounting, alert someone when one is not issued. A public contract from 0.1.0: a field may be added
 * without changing `schema_version`; anything that would break a subscriber gets a new event name (`….v2`),
 * sent alongside the old one until the next major version of the package.
 *
 * Only ids, the number and codes — never the document's content or the buyer's details: a subscriber reads
 * what it needs by id (`EinvoiceDocumentDTO` through the order link, the files through the File Module).
 *
 * Delivery is at least once, like every Medusa event: a subscriber is idempotent by `id` (`refusal_id`). An
 * event goes out right after its document or refusal is written; if the process stops in between, the
 * event is lost — the document itself is not. No event when a redelivered Medusa event finds its document
 * already issued.
 *
 * The types below are published with the package (`@normwerk/einvoice-medusa/events`, built by
 * `tsconfig.types.json`); this file imports nothing of the module so that its declaration stands alone.
 */
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import type { MedusaContainer } from "@medusajs/framework";

/** An invoice or a credit note. */
export type EinvoiceDocumentType = "invoice" | "credit_note";

export const EINVOICE_EVENTS = {
  /** An invoice or credit note was issued — by its Medusa event, or by a retry from the admin. */
  DOCUMENT_ISSUED: "einvoice.document_issued",
  /** A document was not issued: the check against what Medusa charged blocked it, or it was refused. */
  ISSUANCE_BLOCKED: "einvoice.issuance_blocked",
} as const;

export interface DocumentIssuedEvent {
  readonly schema_version: 1;
  /** The document's id — `EinvoiceDocumentDTO.id`. */
  readonly id: string;
  readonly order_id: string;
  readonly type: EinvoiceDocumentType;
  readonly document_number: string;
  /** An invoice: the fulfillment it is for. */
  readonly fulfillment_id?: string;
  /** A credit note for a refund: the refund it credits. */
  readonly refund_id?: string;
  /** An invoice issued with a notice (`VAT_OVERCHARGED`, `VAT_DIFFERS_FROM_MEDUSA`). */
  readonly notice_code?: string;
}

export interface IssuanceBlockedEvent {
  readonly schema_version: 1;
  readonly refusal_id: string;
  readonly order_id: string;
  readonly type: EinvoiceDocumentType;
  /** Why — a code of the error reference. */
  readonly code: string;
}

/** The public view of an issued document — what `order.einvoice_documents` returns and a subscriber reads. */
export interface EinvoiceDocumentDTO {
  readonly id: string;
  readonly type: EinvoiceDocumentType;
  readonly order_id: string;
  readonly document_number: string;
  /** File Module file ids. */
  readonly xml_file_id: string;
  readonly pdf_file_id: string | null;
  /** An invoice issued although it disagrees with what Medusa charged: the codes and amounts. */
  readonly notice: Record<string, unknown> | null;
  /** An intra-EU supply (category K): the VIES answer its exemption rests on, as the merchant's
   * `vatIdVerifier` returned it — the evidence for an audit. `null` for any other document. */
  readonly vat_id_evidence: {
    readonly vatId: string;
    readonly status: "valid" | "invalid" | "unavailable";
    /** `YYYY-MM-DD`. */
    readonly checkedAt: string;
    /** VIES's own reference for the check. */
    readonly consultationNumber?: string;
  } | null;
  /** The rule of the plugin's tax semantics the document followed (`ruleId`, e.g. `tax-semantics#3`), the
   * VAT category and why. `null` only on a document issued by a pre-release version. */
  readonly tax_decisions:
    | readonly {
        readonly ruleId: string;
        readonly categoryCode: string;
        readonly exemptionReasonCode?: string;
        readonly exemptionReasonText?: string;
        readonly reasoning: string;
      }[]
    | null;
}

async function emit(
  container: MedusaContainer,
  name: string,
  data: DocumentIssuedEvent | IssuanceBlockedEvent,
): Promise<void> {
  try {
    await container.resolve(Modules.EVENT_BUS).emit({ name, data });
  } catch (error) {
    // The document or refusal is written; losing its event must not undo that or fail the caller.
    container
      .resolve(ContainerRegistrationKeys.LOGGER)
      .warn(
        `einvoice: event ${name} for order ${data.order_id} not sent — ` +
          (error instanceof Error ? error.message : String(error)),
      );
  }
}

export function emitDocumentIssued(
  container: MedusaContainer,
  event: Omit<DocumentIssuedEvent, "schema_version">,
): Promise<void> {
  return emit(container, EINVOICE_EVENTS.DOCUMENT_ISSUED, { schema_version: 1, ...event });
}

export function emitIssuanceBlocked(
  container: MedusaContainer,
  event: Omit<IssuanceBlockedEvent, "schema_version">,
): Promise<void> {
  return emit(container, EINVOICE_EVENTS.ISSUANCE_BLOCKED, { schema_version: 1, ...event });
}
