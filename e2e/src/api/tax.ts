import type { AdminSession } from "./admin.js";
import { adminFetch, adminGetJson, adminPostJson } from "./admin.js";

/**
 * P-63: a tax rate override for one shipping option in one country's tax region — how a shop ends up
 * charging no VAT on shipping (Medusa's `TaxRateRule`, reference `shipping_option`). Returns the rate's id.
 */
export async function createShippingOptionTaxRate(
  admin: AdminSession,
  countryCode: string,
  shippingOptionId: string,
  rate: number,
): Promise<string> {
  const { tax_regions: regions } = await adminGetJson<{
    readonly tax_regions: readonly { readonly id: string; readonly country_code: string }[];
  }>(admin, `/admin/tax-regions?country_code=${countryCode}&fields=id,country_code,parent_id`);
  const region = regions.find((r) => r.country_code === countryCode);
  if (region === undefined) {
    throw new Error(`createShippingOptionTaxRate: no tax region for "${countryCode}"`);
  }
  const { tax_rate: taxRate } = await adminPostJson<{ readonly tax_rate: { readonly id: string } }>(
    admin,
    "/admin/tax-rates",
    {
      tax_region_id: region.id,
      rate,
      code: `SHIP-${countryCode.toUpperCase()}-${rate}`,
      name: `Shipping ${rate} %`,
      is_combinable: false,
      rules: [{ reference: "shipping_option", reference_id: shippingOptionId }],
    },
  );
  return taxRate.id;
}

export async function deleteTaxRate(admin: AdminSession, taxRateId: string): Promise<void> {
  const response = await adminFetch(admin, `/admin/tax-rates/${taxRateId}`, { method: "DELETE" });
  if (!response.ok && response.status !== 404) {
    throw new Error(`DELETE /admin/tax-rates/${taxRateId} -> ${response.status}`);
  }
}
