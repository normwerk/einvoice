import type { AdminSession } from "./admin.js";
import { adminFetch, adminGetJson, adminPostJson } from "./admin.js";
import { waitFor } from "../harness/wait-for.js";

export interface OrderSummary {
  readonly id: string;
  readonly displayId: number;
  readonly total: number;
  /** P-63: the VAT Medusa charged. */
  readonly taxTotal: number;
  /** P-63: store credit, gift cards and refunds Medusa subtracted from `total`. */
  readonly creditLineTotal: number;
  readonly currencyCode: string;
  readonly itemIds: readonly string[];
  readonly items: readonly { readonly id: string; readonly quantity: number }[];
}

export async function getOrder(admin: AdminSession, orderId: string): Promise<OrderSummary> {
  const response = await adminGetJson<{
    readonly order: {
      readonly id: string;
      readonly display_id: number;
      readonly total: number;
      readonly tax_total: number;
      readonly credit_line_total?: number | null;
      readonly currency_code: string;
      readonly items: readonly { readonly id: string; readonly quantity: number }[];
    };
  }>(
    admin,
    `/admin/orders/${orderId}?fields=id,display_id,total,tax_total,credit_line_total,currency_code,*items`,
  );
  return {
    id: response.order.id,
    displayId: response.order.display_id,
    total: response.order.total,
    taxTotal: response.order.tax_total,
    creditLineTotal: response.order.credit_line_total ?? 0,
    currencyCode: response.order.currency_code,
    itemIds: response.order.items.map((item) => item.id),
    items: response.order.items.map((item) => ({ id: item.id, quantity: item.quantity })),
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
    items: order.items.map(({ id, quantity }) => ({ id, quantity })),
  });
}

/** The order's single fulfillment id — every scenario in this suite ships an order in one shipment. */
export async function getOrderFulfillmentId(admin: AdminSession, orderId: string): Promise<string> {
  const response = await adminGetJson<{
    readonly order: { readonly fulfillments: readonly { readonly id: string }[] };
  }>(admin, `/admin/orders/${orderId}?fields=*fulfillments`);
  const fulfillmentId = response.order.fulfillments[0]?.id;
  if (fulfillmentId === undefined) {
    throw new Error(`getOrderFulfillmentId: order ${orderId} has no fulfillment`);
  }
  return fulfillmentId;
}

export interface EinvoiceDocumentSummary {
  readonly id: string;
  readonly type: "invoice" | "credit_note";
  readonly documentNumber: string;
  readonly xmlUrl: string;
  readonly pdfUrl: string | null;
  /** P-63: admin listing only. */
  readonly notice?: EinvoiceStatusEntry | null;
}

/** P-63: a notice on a document, or why a document was not issued. */
export interface EinvoiceStatusEntry {
  readonly code: string;
  readonly message: string;
  readonly details: Readonly<Record<string, unknown>>;
}

export interface EinvoiceRefusalSummary extends EinvoiceStatusEntry {
  readonly id: string;
  readonly type: "invoice" | "credit_note";
  readonly idempotencyKey: string;
  readonly retryUrl: string;
}

/** P-63: the admin listing — documents with their notices, and the documents the plugin did not issue. */
export async function getEinvoiceStatus(
  admin: AdminSession,
  orderId: string,
): Promise<{
  readonly documents: readonly EinvoiceDocumentSummary[];
  readonly refusals: readonly EinvoiceRefusalSummary[];
}> {
  return adminGetJson(admin, `/admin/orders/${orderId}/einvoice`);
}

/** P-63: the admin widget's "Retry" — issues a refused document again. */
export async function retryRefusal(
  admin: AdminSession,
  refusal: EinvoiceRefusalSummary,
): Promise<{ readonly outcome: string; readonly documentNumber?: string; readonly code?: string }> {
  return adminPostJson(admin, refusal.retryUrl, {});
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

/** Cancels the order the way an admin does: its fulfillment first (Medusa refuses to cancel an order with
 * a fulfillment that is not cancelled), then the order itself — real
 * `POST /admin/orders/:id/fulfillments/:fulfillment_id/cancel` and `POST /admin/orders/:id/cancel`. The
 * second is what emits `order.canceled`. */
export async function cancelOrder(admin: AdminSession, orderId: string): Promise<void> {
  const fulfillmentId = await getOrderFulfillmentId(admin, orderId);
  await adminPostJson(admin, `/admin/orders/${orderId}/fulfillments/${fulfillmentId}/cancel`, {});
  await adminPostJson(admin, `/admin/orders/${orderId}/cancel`, {});
}

/** Sets `order.metadata` the way a merchant records an order-level declaration such as
 * `regime_override` (`docs/quickstart-medusa.md`) — real `POST /admin/orders/:id`. */
export async function setOrderMetadata(
  admin: AdminSession,
  orderId: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  await adminPostJson(admin, `/admin/orders/${orderId}`, { metadata });
}

/** Waits for the order's first document of a type and returns it with its XML. */
export async function waitForDocumentXml(
  admin: AdminSession,
  orderId: string,
  type: EinvoiceDocumentSummary["type"],
): Promise<{ readonly document: EinvoiceDocumentSummary; readonly xmlBytes: Buffer }> {
  let document: EinvoiceDocumentSummary | undefined;
  await waitFor(
    `${type} for order ${orderId}`,
    async () => {
      document = (await listEinvoiceDocuments(admin, orderId)).find((d) => d.type === type);
      return document !== undefined;
    },
    { timeoutMs: 30_000 },
  );
  if (document === undefined) {
    throw new Error("unreachable: waitFor guarantees the document exists");
  }
  return { document, xmlBytes: await downloadEinvoiceFile(admin, orderId, document.id, "xml") };
}
