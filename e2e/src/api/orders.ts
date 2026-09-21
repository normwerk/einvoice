import type { AdminSession } from "./admin.js";
import { adminFetch, adminGetJson, adminPostJson } from "./admin.js";

export interface OrderSummary {
  readonly id: string;
  readonly displayId: number;
  readonly total: number;
  readonly currencyCode: string;
  readonly itemIds: readonly string[];
}

export async function getOrder(admin: AdminSession, orderId: string): Promise<OrderSummary> {
  const response = await adminGetJson<{
    readonly order: {
      readonly id: string;
      readonly display_id: number;
      readonly total: number;
      readonly currency_code: string;
      readonly items: readonly { readonly id: string }[];
    };
  }>(admin, `/admin/orders/${orderId}?fields=id,display_id,total,currency_code,*items`);
  return {
    id: response.order.id,
    displayId: response.order.display_id,
    total: response.order.total,
    currencyCode: response.order.currency_code,
    itemIds: response.order.items.map((item) => item.id),
  };
}

/** Fulfills every item on the order in one shipment — real `POST /admin/orders/:id/fulfillments`, verified
 * against a real run. This is what actually triggers `order.fulfillment_created` and the plugin's own
 * subscriber (`invoice-on-fulfillment-created.ts`). */
export async function fulfillOrder(
  admin: AdminSession,
  orderId: string,
  stockLocationId: string,
): Promise<void> {
  const order = await getOrder(admin, orderId);
  await adminPostJson(admin, `/admin/orders/${orderId}/fulfillments`, {
    location_id: stockLocationId,
    items: order.itemIds.map((id) => ({ id, quantity: 1 })),
  });
}

export interface EinvoiceDocumentSummary {
  readonly id: string;
  readonly type: "invoice" | "credit_note";
  readonly documentNumber: string;
  readonly xmlUrl: string;
  readonly pdfUrl: string | null;
}

/** `basePath` is `/admin/orders/:id` or `/store/orders/:id` — mirrors the plugin's own
 * `listEinvoiceDocumentSummaries` (`packages/einvoice-medusa/src/api/einvoice-http.ts`), which returns URLs
 * rooted at whichever tree served the request. */
export async function listEinvoiceDocuments(
  admin: AdminSession,
  orderId: string,
): Promise<readonly EinvoiceDocumentSummary[]> {
  const response = await adminGetJson<{ readonly documents: readonly EinvoiceDocumentSummary[] }>(
    admin,
    `/admin/orders/${orderId}/einvoice`,
  );
  return response.documents;
}

export async function downloadEinvoiceFile(
  admin: AdminSession,
  orderId: string,
  documentId: string,
  kind: "xml" | "pdf",
): Promise<Buffer> {
  const response = await adminFetch(
    admin,
    `/admin/orders/${orderId}/einvoice/${documentId}/${kind}`,
  );
  if (!response.ok) {
    throw new Error(
      `downloadEinvoiceFile(${kind}) -> ${response.status}: ${await response.text().catch(() => "<no body>")}`,
    );
  }
  return Buffer.from(await response.arrayBuffer());
}
