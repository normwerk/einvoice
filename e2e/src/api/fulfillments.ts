import type { AdminSession } from "./admin.js";
import { adminGetJson, adminPostJson } from "./admin.js";

/** P-67: a fulfillment of the order with the order lines and quantities it ships. */
export interface FulfillmentSummary {
  readonly id: string;
  readonly createdAt: string;
  readonly canceledAt: string | null;
  readonly items: readonly { readonly lineItemId: string; readonly quantity: number }[];
}

/** P-67: fulfills some of the order's lines — real `POST /admin/orders/:id/fulfillments`, the way an admin
 * ships an order in parts. Returns the new fulfillment's id. */
export async function fulfillItems(
  admin: AdminSession,
  orderId: string,
  stockLocationId: string,
  items: readonly { readonly id: string; readonly quantity: number }[],
): Promise<string> {
  const before = new Set((await listFulfillments(admin, orderId)).map((f) => f.id));
  await adminPostJson(admin, `/admin/orders/${orderId}/fulfillments`, {
    location_id: stockLocationId,
    items,
  });
  const created = (await listFulfillments(admin, orderId)).find((f) => !before.has(f.id));
  if (created === undefined) {
    throw new Error(`fulfillItems: no new fulfillment on order ${orderId}`);
  }
  return created.id;
}

/** P-67: the order's fulfillments, oldest first. */
export async function listFulfillments(
  admin: AdminSession,
  orderId: string,
): Promise<readonly FulfillmentSummary[]> {
  const { order } = await adminGetJson<{
    readonly order: {
      readonly fulfillments?: readonly {
        readonly id: string;
        readonly created_at: string;
        readonly canceled_at?: string | null;
        readonly items?: readonly {
          readonly line_item_id: string;
          readonly quantity: number;
        }[];
      }[];
    };
  }>(admin, `/admin/orders/${orderId}?fields=*fulfillments,*fulfillments.items`);
  return (order.fulfillments ?? [])
    .map((f) => ({
      id: f.id,
      createdAt: f.created_at,
      canceledAt: f.canceled_at ?? null,
      items: (f.items ?? []).map((item) => ({
        lineItemId: item.line_item_id,
        quantity: Number(item.quantity),
      })),
    }))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** P-67: cancels one fulfillment — real `POST /admin/orders/:id/fulfillments/:fulfillment_id/cancel`, which
 * emits `order.fulfillment_canceled`. */
export async function cancelFulfillment(
  admin: AdminSession,
  orderId: string,
  fulfillmentId: string,
): Promise<void> {
  await adminPostJson(admin, `/admin/orders/${orderId}/fulfillments/${fulfillmentId}/cancel`, {});
}
