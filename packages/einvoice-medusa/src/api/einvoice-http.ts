/**
 * T-074: shared logic behind both the admin and store "download e-invoice" routes — listing and
 * streaming are identical between the two (`src/api/admin/orders/[id]/einvoice/...`,
 * `src/api/store/orders/[id]/einvoice/...`); only who's allowed to call them differs (an admin user vs. an
 * authenticated customer who owns the order, enforced by each route tree's own `middlewares.ts`/handler,
 * not here).
 */
import type {
  AuthenticatedMedusaRequest,
  MedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { EINVOICE_MODULE } from "../modules/einvoice/index.js";
import type EinvoiceModuleService from "../modules/einvoice/service.js";
import { fetchFileBytes } from "../storage.js";
import type { EinvoiceRefusalRecord } from "../modules/einvoice/service.js";
import {
  describeChargedReconciliation,
  type InvoiceNotice,
} from "../mapping/charged-reconciliation.js";
import { describeRefusal } from "../refusals.js";

export interface EinvoiceDocumentSummary {
  readonly id: string;
  readonly type: "invoice" | "credit_note";
  readonly documentNumber: string;
  readonly xmlUrl: string;
  readonly pdfUrl: string | null;
}

/**
 * Lists this order's e-invoice documents, newest first — `basePath` is `/admin/orders/:id` or
 * `/store/orders/:id`, whichever tree is calling this, so the returned URLs point back at that same
 * tree's own download routes rather than assuming one or the other.
 */
export async function listEinvoiceDocumentSummaries(
  req: MedusaRequest,
  orderId: string,
  basePath: string,
): Promise<readonly EinvoiceDocumentSummary[]> {
  const einvoiceService = req.scope.resolve<EinvoiceModuleService>(EINVOICE_MODULE);
  const documents = await einvoiceService.listEinvoiceDocuments(
    { order_id: orderId },
    { order: { created_at: "DESC" } },
  );
  return documents.map((document) => ({
    id: document.id,
    type: document.type,
    documentNumber: document.document_number,
    xmlUrl: `${basePath}/einvoice/${document.id}/xml`,
    pdfUrl: document.pdf_file_id === null ? null : `${basePath}/einvoice/${document.id}/pdf`,
  }));
}

/** P-63: a notice or a refusal as the admin widget shows it — the code, the explanation, the amounts. */
export interface EinvoiceStatusSummary {
  readonly code: string;
  readonly message: string;
  readonly details: Record<string, unknown>;
}

export interface AdminEinvoiceDocumentSummary extends EinvoiceDocumentSummary {
  /** Issued although it states less VAT than Medusa charged — `null` otherwise. Admin only: it tells the
   * merchant what to refund, which is not the buyer's view of their invoice. */
  readonly notice: EinvoiceStatusSummary | null;
}

export interface AdminEinvoiceRefusalSummary extends EinvoiceStatusSummary {
  readonly id: string;
  readonly type: "invoice" | "credit_note";
  /** The fulfillment (invoice) the document was for. */
  readonly idempotencyKey: string;
  readonly updatedAt: string;
  readonly retryUrl: string;
}

/**
 * P-63: the admin view of an order's e-invoices — the documents with their notices, and the documents the
 * plugin did not issue, each with the route that retries it.
 */
export async function listAdminEinvoiceStatus(
  req: MedusaRequest,
  orderId: string,
): Promise<{
  readonly documents: readonly AdminEinvoiceDocumentSummary[];
  readonly refusals: readonly AdminEinvoiceRefusalSummary[];
}> {
  const einvoiceService = req.scope.resolve<EinvoiceModuleService>(EINVOICE_MODULE);
  const basePath = `/admin/orders/${orderId}`;
  const documents = await einvoiceService.listEinvoiceDocuments(
    { order_id: orderId },
    { order: { created_at: "DESC" } },
  );
  const refusals = (await einvoiceService.listEinvoiceRefusals(
    { order_id: orderId },
    { order: { created_at: "DESC" } },
  )) as unknown as EinvoiceRefusalRecord[];
  return {
    documents: documents.map((document) => {
      const notice = document.notice as unknown as InvoiceNotice | null;
      return {
        id: document.id,
        type: document.type,
        documentNumber: document.document_number,
        xmlUrl: `${basePath}/einvoice/${document.id}/xml`,
        pdfUrl: document.pdf_file_id === null ? null : `${basePath}/einvoice/${document.id}/pdf`,
        notice:
          notice === null || notice === undefined
            ? null
            : {
                code: notice.code,
                message: describeChargedReconciliation(notice),
                details: { ...notice },
              },
      };
    }),
    refusals: refusals.map((refusal) => ({
      id: refusal.id,
      type: refusal.type,
      idempotencyKey: refusal.idempotency_key,
      code: refusal.code,
      message: describeRefusal(refusal),
      details: refusal.details,
      updatedAt: new Date(refusal.updated_at).toISOString(),
      retryUrl: `${basePath}/einvoice/refusals/${refusal.id}/retry`,
    })),
  };
}

/**
 * Streams one document's XML or PDF back, after confirming the requested document id actually belongs to
 * the requested order id — a route handler passing a `documentId` it merely found in `req.params` without
 * this check would let anyone who can guess/enumerate a document id read it by pairing it with *any*
 * order id they're otherwise authorized for, which defeats the store route's own ownership check
 * (`src/api/store/orders/[id]/einvoice/[documentId]/*`'s own doc comment).
 */
export async function sendEinvoiceFile(
  req: MedusaRequest,
  res: MedusaResponse,
  params: { readonly orderId: string; readonly documentId: string; readonly kind: "xml" | "pdf" },
): Promise<void> {
  const einvoiceService = req.scope.resolve<EinvoiceModuleService>(EINVOICE_MODULE);
  const documents = await einvoiceService.listEinvoiceDocuments({
    id: params.documentId,
    order_id: params.orderId,
  });
  const document = documents[0];
  if (document === undefined) {
    res
      .status(404)
      .json({ message: `No e-invoice document ${params.documentId} for order ${params.orderId}.` });
    return;
  }

  const fileId = params.kind === "xml" ? document.xml_file_id : document.pdf_file_id;
  if (fileId === null) {
    res.status(404).json({ message: `Document ${params.documentId} has no ${params.kind} file.` });
    return;
  }

  const bytes = await fetchFileBytes(req.scope, fileId);
  const filename = `${document.document_number}.${params.kind}`;
  res.setHeader("Content-Type", params.kind === "xml" ? "application/xml" : "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.status(200).send(Buffer.from(bytes));
}

/**
 * The store routes' own ownership check (`src/api/store/orders/[id]/einvoice/**`) — Medusa's own built-in
 * `GET /store/orders/:id` has no equivalent check at all (`@medusajs/medusa`'s own compiled route carries
 * a `// TODO: Do we want to apply some sort of authentication here?`, confirmed by reading it directly,
 * not assumed), which this plugin deliberately does not copy: an e-invoice carries the same buyer
 * name/address (and sometimes VAT-ID) `storage.ts`'s own doc comment already treats as worth keeping
 * private, so a document this plugin serves needs its own real ownership check rather than inheriting a
 * gap Medusa's own maintainers have left open with a TODO, not a deliberate "this is fine".
 */
export async function customerOwnsOrder(
  req: AuthenticatedMedusaRequest,
  orderId: string,
): Promise<boolean> {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);
  const { data: orders } = await query.graph({
    entity: "order",
    filters: { id: orderId },
    fields: ["customer_id"],
  });
  const order = orders[0] as { readonly customer_id?: string | null } | undefined;
  return order !== undefined && order.customer_id === req.auth_context.actor_id;
}
