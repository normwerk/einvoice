import type { AdminSession } from "./admin.js";
import { adminGetJson, adminPostJson } from "./admin.js";

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

/**
 * Switches the region's prices (and the EUR currency's) between net and tax-inclusive — Medusa's own price
 * preferences, created with the region; real `POST /admin/price-preferences/:id`. A scenario that switches
 * them must switch them back: every other scenario on the stand prices net.
 */
export async function setRegionPricesIncludeTax(
  admin: AdminSession,
  regionId: string,
  inclusive: boolean,
): Promise<void> {
  const { price_preferences: preferences } = await adminGetJson<{
    readonly price_preferences: readonly {
      readonly id: string;
      readonly attribute: string;
      readonly value: string;
    }[];
  }>(admin, "/admin/price-preferences?limit=50");
  const targets = preferences.filter(
    (p) =>
      (p.attribute === "region_id" && p.value === regionId) ||
      (p.attribute === "currency_code" && p.value === "eur"),
  );
  if (targets.length !== 2) {
    throw new Error(
      `setRegionPricesIncludeTax: expected 2 price preferences, found ${targets.length}`,
    );
  }
  for (const preference of targets) {
    await adminPostJson(admin, `/admin/price-preferences/${preference.id}`, {
      is_tax_inclusive: inclusive,
    });
  }
}

/** P-65: the product a variant belongs to — a tax rate override names the product. */
export async function productIdOfVariant(admin: AdminSession, variantId: string): Promise<string> {
  const { products } = await adminGetJson<{
    readonly products: readonly {
      readonly id: string;
      readonly variants: readonly { readonly id: string }[];
    }[];
  }>(admin, "/admin/products?limit=100&fields=id,*variants");
  const product = products.find((p) => p.variants.some((v) => v.id === variantId));
  if (product === undefined) {
    throw new Error(`productIdOfVariant: no product has variant ${variantId}`);
  }
  return product.id;
}

/**
 * T-202: a set — a variant with stock managed that draws on two inventory items, one table and four chairs
 * (`required_quantity` 4), both stocked at the stand's location. Medusa ships such a line as one fulfillment
 * item per inventory item. Returns the variant id.
 */
export async function createSetProduct(
  admin: AdminSession,
  input: {
    readonly title: string;
    readonly sku: string;
    readonly priceEur: number;
    readonly salesChannelId: string;
    readonly stockLocationId: string;
    readonly shippingOptionId: string;
  },
): Promise<string> {
  const { shipping_options: options } = await adminGetJson<{
    readonly shipping_options: readonly { readonly shipping_profile_id: string }[];
  }>(admin, `/admin/shipping-options?id=${input.shippingOptionId}&fields=shipping_profile_id`);
  const shippingProfileId = options[0]?.shipping_profile_id;
  if (shippingProfileId === undefined) {
    throw new Error(`createSetProduct: no shipping option ${input.shippingOptionId}`);
  }
  const parts = [
    { sku: `${input.sku}-TABLE`, title: "Tisch", requiredQuantity: 1 },
    { sku: `${input.sku}-CHAIR`, title: "Stuhl", requiredQuantity: 4 },
  ];
  const inventoryItems: { inventory_item_id: string; required_quantity: number }[] = [];
  for (const part of parts) {
    const { inventory_item: item } = await adminPostJson<{
      readonly inventory_item: { readonly id: string };
    }>(admin, "/admin/inventory-items", { sku: part.sku, title: part.title });
    await adminPostJson(admin, `/admin/inventory-items/${item.id}/location-levels`, {
      location_id: input.stockLocationId,
      stocked_quantity: 1000,
    });
    inventoryItems.push({ inventory_item_id: item.id, required_quantity: part.requiredQuantity });
  }
  const { product } = await adminPostJson<{
    readonly product: { readonly variants: readonly { readonly id: string }[] };
  }>(admin, "/admin/products", {
    title: input.title,
    status: "published",
    shipping_profile_id: shippingProfileId,
    options: [{ title: "Ausführung", values: ["Standard"] }],
    variants: [
      {
        title: "Standard",
        sku: input.sku,
        manage_inventory: true,
        prices: [{ currency_code: "eur", amount: input.priceEur }],
        options: { Ausführung: "Standard" },
        inventory_items: inventoryItems,
      },
    ],
    sales_channels: [{ id: input.salesChannelId }],
  });
  const variantId = product.variants[0]?.id;
  if (variantId === undefined) {
    throw new Error(`createSetProduct: ${input.sku} was created without a variant`);
  }
  return variantId;
}
