import type { AdminSession } from "./admin.js";
import { adminPostJson } from "./admin.js";

/** A percentage promotion on items, applied by code — real `POST /admin/promotions`, verified against a
 * real run. */
export async function createPercentagePromotion(
  admin: AdminSession,
  code: string,
  percent: number,
): Promise<void> {
  await adminPostJson(admin, "/admin/promotions", {
    code,
    type: "standard",
    status: "active",
    application_method: {
      type: "percentage",
      target_type: "items",
      allocation: "across",
      value: percent,
    },
  });
}

/**
 * A service: a product with no shipping profile whose variant manages no inventory — Medusa then marks its
 * line `requires_shipping: false` and completes a cart holding only such lines without a shipping method
 * (verified against a real run). Returns the variant id.
 */
export async function createServiceProduct(
  admin: AdminSession,
  input: {
    readonly title: string;
    readonly sku: string;
    readonly priceEur: number;
    readonly salesChannelId: string;
  },
): Promise<string> {
  const { product } = await adminPostJson<{
    readonly product: { readonly variants: readonly { readonly id: string }[] };
  }>(admin, "/admin/products", {
    title: input.title,
    status: "published",
    options: [{ title: "Umfang", values: ["Standard"] }],
    variants: [
      {
        title: "Standard",
        sku: input.sku,
        manage_inventory: false,
        prices: [{ currency_code: "eur", amount: input.priceEur }],
        options: { Umfang: "Standard" },
      },
    ],
    sales_channels: [{ id: input.salesChannelId }],
  });
  const variantId = product.variants[0]?.id;
  if (variantId === undefined) {
    throw new Error(`createServiceProduct: ${input.sku} was created without a variant`);
  }
  return variantId;
}
