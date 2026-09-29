import type { AdminSession } from "./admin.js";
import { adminGetJson, adminPostJson } from "./admin.js";

/**
 * T-201: an exchange through the admin API, the way a merchant makes one — the order's line comes back, another
 * variant goes out by the given shipping option (Medusa reserves stock for it only with one); requested and
 * confirmed. Returns the exchange's new order line.
 */
export async function exchangeItem(
  admin: AdminSession,
  orderId: string,
  returnedItemId: string,
  newVariantId: string,
  shippingOptionId: string,
): Promise<string> {
  const { exchange } = await adminPostJson<{ readonly exchange: { readonly id: string } }>(
    admin,
    "/admin/exchanges",
    { order_id: orderId },
  );
  await adminPostJson(admin, `/admin/exchanges/${exchange.id}/inbound/items`, {
    items: [{ id: returnedItemId, quantity: 1 }],
  });
  await adminPostJson(admin, `/admin/exchanges/${exchange.id}/outbound/items`, {
    items: [{ variant_id: newVariantId, quantity: 1 }],
  });
  await adminPostJson(admin, `/admin/exchanges/${exchange.id}/outbound/shipping-method`, {
    shipping_option_id: shippingOptionId,
  });
  await adminPostJson(admin, `/admin/exchanges/${exchange.id}/request`, {});
  return newLine(admin, `/admin/exchanges/${exchange.id}`, "exchange");
}

/**
 * T-201: a warranty claim with a replacement — the order's line claimed as faulty, the same variant sent again;
 * shipped by the given shipping option; requested and confirmed. Returns the replacement's order line.
 */
export async function claimReplacement(
  admin: AdminSession,
  orderId: string,
  claimedItemId: string,
  variantId: string,
  shippingOptionId: string,
): Promise<string> {
  const { claim } = await adminPostJson<{ readonly claim: { readonly id: string } }>(
    admin,
    "/admin/claims",
    { order_id: orderId, type: "replace" },
  );
  await adminPostJson(admin, `/admin/claims/${claim.id}/claim-items`, {
    items: [{ id: claimedItemId, quantity: 1, reason: "production_failure" }],
  });
  await adminPostJson(admin, `/admin/claims/${claim.id}/outbound/items`, {
    items: [{ variant_id: variantId, quantity: 1 }],
  });
  await adminPostJson(admin, `/admin/claims/${claim.id}/outbound/shipping-method`, {
    shipping_option_id: shippingOptionId,
  });
  await adminPostJson(admin, `/admin/claims/${claim.id}/request`, {});
  return newLine(admin, `/admin/claims/${claim.id}`, "claim");
}

async function newLine(
  admin: AdminSession,
  path: string,
  key: "exchange" | "claim",
): Promise<string> {
  const response = await adminGetJson<
    Record<
      string,
      {
        readonly additional_items?: readonly {
          readonly item_id: string;
          readonly is_additional_item?: boolean;
        }[];
      }
    >
  >(admin, `${path}?fields=id,*additional_items`);
  const item = (response[key]?.additional_items ?? []).find(
    (candidate) => candidate.is_additional_item !== false,
  );
  if (item === undefined) throw new Error(`${path} has no new item`);
  return item.item_id;
}

/** T-201: an order edit that sets a line's unit price — requested and confirmed through the admin API. */
export async function editUnitPrice(
  admin: AdminSession,
  orderId: string,
  itemId: string,
  quantity: number,
  unitPrice: number,
): Promise<void> {
  await adminPostJson(admin, "/admin/order-edits", { order_id: orderId });
  await adminPostJson(admin, `/admin/order-edits/${orderId}/items/item/${itemId}`, {
    quantity,
    unit_price: unitPrice,
  });
  await adminPostJson(admin, `/admin/order-edits/${orderId}/request`, {});
  await adminPostJson(admin, `/admin/order-edits/${orderId}/confirm`, {});
}
