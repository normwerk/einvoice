import type { AdminSession } from "./admin.js";
import { adminGetJson, adminPostJson } from "./admin.js";

export interface OrderItemValue {
  readonly id: string;
  readonly variantId: string;
  readonly quantity: number;
  /** VAT included, after the line's discounts. */
  readonly total: number;
}

/** P-65: the order's lines with their gross totals — `total` at the top makes Medusa compute them. */
export async function getOrderItemValues(
  admin: AdminSession,
  orderId: string,
): Promise<readonly OrderItemValue[]> {
  const { order } = await adminGetJson<{
    readonly order: {
      readonly items: readonly {
        readonly id: string;
        readonly variant_id: string;
        readonly quantity: number;
        readonly total: number;
      }[];
    };
  }>(admin, `/admin/orders/${orderId}?fields=id,total,*items`);
  return order.items.map((item) => ({
    id: item.id,
    variantId: item.variant_id,
    quantity: item.quantity,
    total: item.total,
  }));
}

/**
 * P-65: the buyer sends goods back and the shop receives them — Medusa's return flow over the Admin API:
 * begin a return, request the items, confirm the request, begin receiving, receive the items, confirm.
 * Returns the return's id.
 */
export async function receiveReturn(
  admin: AdminSession,
  orderId: string,
  locationId: string,
  items: readonly { readonly itemId: string; readonly quantity: number }[],
): Promise<string> {
  const created = await adminPostJson<{ readonly return: { readonly id: string } }>(
    admin,
    "/admin/returns",
    { order_id: orderId, location_id: locationId },
  );
  const returnId = created.return.id;
  const lines = items.map((item) => ({ id: item.itemId, quantity: item.quantity }));
  await adminPostJson(admin, `/admin/returns/${returnId}/request-items`, { items: lines });
  await adminPostJson(admin, `/admin/returns/${returnId}/request`, {});
  await adminPostJson(admin, `/admin/returns/${returnId}/receive`, {});
  await adminPostJson(admin, `/admin/returns/${returnId}/receive-items`, { items: lines });
  await adminPostJson(admin, `/admin/returns/${returnId}/receive/confirm`, {});
  return returnId;
}
