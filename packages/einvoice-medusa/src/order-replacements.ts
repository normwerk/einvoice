/**
 * T-201: an order's exchanges and claims, as `mapping/replacement.ts` reads them. The order has no relation to
 * either (`@medusajs/order`), so each is queried by `order_id`.
 */
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import type { MedusaContainer } from "@medusajs/framework";
import type { MedusaOrderClaim, MedusaOrderExchange } from "./mapping/replacement.js";

export async function loadExchangesAndClaims(
  container: MedusaContainer,
  orderId: string,
): Promise<{
  readonly exchanges: readonly MedusaOrderExchange[];
  readonly claims: readonly MedusaOrderClaim[];
}> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const [{ data: exchanges }, { data: claims }] = await Promise.all([
    query.graph({
      entity: "order_exchange",
      filters: { order_id: orderId },
      fields: ["id", "canceled_at", "additional_items.item_id"],
    }),
    query.graph({
      entity: "order_claim",
      filters: { order_id: orderId },
      fields: [
        "id",
        "canceled_at",
        "additional_items.item_id",
        "additional_items.is_additional_item",
      ],
    }),
  ]);
  return {
    exchanges: exchanges as unknown as MedusaOrderExchange[],
    claims: claims as unknown as MedusaOrderClaim[],
  };
}
