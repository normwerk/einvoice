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
