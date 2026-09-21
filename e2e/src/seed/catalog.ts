import type { AdminSession } from "../api/admin.js";
import { adminGetJson } from "../api/admin.js";

export interface Catalog {
  readonly regionId: string;
  readonly salesChannelId: string;
  readonly publishableKey: string;
  readonly stockLocationId: string;
  /** `sku -> variant id`, e.g. `variantIdBySku["SHIRT-S-BLACK"]`. */
  readonly variantIdBySku: ReadonlyMap<string, string>;
  readonly shippingOptionId: string;
}

/**
 * Looks up the demo store `e2e/app/src/migration-scripts/initial-data-seed.ts` creates automatically on
 * every fresh `medusa db:migrate` (a real, committed part of the `fast`-profile app, not something this
 * suite seeds itself) — a region covering DE/FR/… on EUR, one sales channel, a handful of products with
 * multiple variants, one stock location, two shipping options. Scenarios read what they need from here by
 * SKU/name rather than assuming array order or hard-coding an id that changes every stand run.
 */
export async function loadCatalog(admin: AdminSession): Promise<Catalog> {
  const [regions, salesChannels, apiKeys, products, shippingOptions, stockLocations] =
    await Promise.all([
      adminGetJson<{ readonly regions: readonly { readonly id: string; readonly name: string }[] }>(
        admin,
        "/admin/regions?fields=id,name",
      ),
      adminGetJson<{
        readonly sales_channels: readonly { readonly id: string; readonly name: string }[];
      }>(admin, "/admin/sales-channels"),
      adminGetJson<{
        readonly api_keys: readonly {
          readonly id: string;
          readonly token: string;
          readonly type: string;
        }[];
      }>(admin, "/admin/api-keys?type=publishable&limit=1"),
      adminGetJson<{
        readonly products: readonly {
          readonly variants: readonly { readonly id: string; readonly sku: string | null }[];
        }[];
      }>(admin, "/admin/products?limit=100&fields=id,*variants"),
      adminGetJson<{
        readonly shipping_options: readonly { readonly id: string; readonly name: string }[];
      }>(admin, "/admin/shipping-options?limit=20"),
      adminGetJson<{
        readonly stock_locations: readonly { readonly id: string; readonly name: string }[];
      }>(admin, "/admin/stock-locations"),
    ]);

  const region = regions.regions.find((r) => r.name === "Europe");
  if (region === undefined) {
    throw new Error(
      `loadCatalog: no "Europe" region — regions were: ${JSON.stringify(regions.regions)}`,
    );
  }
  const salesChannel = salesChannels.sales_channels[0];
  if (salesChannel === undefined) {
    throw new Error("loadCatalog: no sales channel found.");
  }
  const apiKey = apiKeys.api_keys[0];
  if (apiKey === undefined) {
    throw new Error("loadCatalog: no publishable API key found.");
  }
  const shippingOption = shippingOptions.shipping_options.find(
    (o) => o.name === "Standard Shipping",
  );
  if (shippingOption === undefined) {
    throw new Error(
      `loadCatalog: no "Standard Shipping" option — options were: ${JSON.stringify(shippingOptions.shipping_options)}`,
    );
  }
  const stockLocation = stockLocations.stock_locations[0];
  if (stockLocation === undefined) {
    throw new Error("loadCatalog: no stock location found.");
  }

  const variantIdBySku = new Map<string, string>();
  for (const product of products.products) {
    for (const variant of product.variants) {
      if (variant.sku !== null) {
        variantIdBySku.set(variant.sku, variant.id);
      }
    }
  }

  return {
    regionId: region.id,
    salesChannelId: salesChannel.id,
    publishableKey: apiKey.token,
    stockLocationId: stockLocation.id,
    variantIdBySku,
    shippingOptionId: shippingOption.id,
  };
}

/** Looks up a variant by SKU, throwing with the full known-SKU list rather than returning `undefined` — a
 * missing SKU here means the demo seed script changed shape, which every scenario needs to fail loudly on,
 * not silently skip a line item. */
export function requireVariantId(catalog: Catalog, sku: string): string {
  const id = catalog.variantIdBySku.get(sku);
  if (id === undefined) {
    throw new Error(
      `requireVariantId: no variant with sku ${JSON.stringify(sku)} — known SKUs: ${JSON.stringify([...catalog.variantIdBySku.keys()])}`,
    );
  }
  return id;
}
