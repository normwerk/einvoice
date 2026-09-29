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
  return createTaxRateOverride(admin, countryCode, "shipping_option", shippingOptionId, rate);
}

/** P-65: a tax rate override for one product — how a shop charges the reduced rate on a book. */
export async function createProductTaxRate(
  admin: AdminSession,
  countryCode: string,
  productId: string,
  rate: number,
): Promise<string> {
  return createTaxRateOverride(admin, countryCode, "product", productId, rate);
}

async function createTaxRateOverride(
  admin: AdminSession,
  countryCode: string,
  reference: "shipping_option" | "product",
  referenceId: string,
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
      code: `${reference.toUpperCase()}-${countryCode.toUpperCase()}-${rate}`,
      name: `${reference} ${rate} %`,
      is_combinable: false,
      rules: [{ reference, reference_id: referenceId }],
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

interface TaxRegion {
  readonly id: string;
  readonly country_code: string;
  readonly parent_id: string | null;
  readonly tax_rates?: readonly {
    readonly id: string;
    readonly rate: number | null;
    readonly is_default: boolean;
  }[];
}

/** T-203: a country's own tax region (not a province's), or `undefined` when the shop has none. */
export async function findTaxRegion(
  admin: AdminSession,
  countryCode: string,
): Promise<TaxRegion | undefined> {
  const { tax_regions: regions } = await adminGetJson<{
    readonly tax_regions: readonly TaxRegion[];
  }>(
    admin,
    `/admin/tax-regions?country_code=${countryCode}` +
      "&fields=id,country_code,parent_id,tax_rates.id,tax_rates.rate,tax_rates.is_default",
  );
  return regions.find((r) => r.country_code === countryCode && r.parent_id === null);
}

/** T-203: sets the rate of a country's default tax rate — 0 is how a shop charges no VAT at all. */
export async function setDefaultTaxRate(
  admin: AdminSession,
  countryCode: string,
  rate: number,
): Promise<void> {
  const defaultRate = (await findTaxRegion(admin, countryCode))?.tax_rates?.find(
    (r) => r.is_default,
  );
  if (defaultRate === undefined) {
    throw new Error(`setDefaultTaxRate: no default tax rate for "${countryCode}"`);
  }
  await adminPostJson(admin, `/admin/tax-rates/${defaultRate.id}`, { rate });
}

/** T-203: removes a country's tax region — the shop then has no tax setting for it at all. */
export async function deleteTaxRegion(admin: AdminSession, countryCode: string): Promise<void> {
  const region = await findTaxRegion(admin, countryCode);
  if (region === undefined) return;
  const response = await adminFetch(admin, `/admin/tax-regions/${region.id}`, { method: "DELETE" });
  if (!response.ok && response.status !== 404) {
    throw new Error(`DELETE /admin/tax-regions/${region.id} -> ${response.status}`);
  }
}

/** T-203: the German tax region as the stand seeds it — created when missing, its default rate set back to
 * 19 % otherwise. Every scenario that changes it ends here, even when it fails. */
export async function restoreGermanTaxRegion(admin: AdminSession): Promise<void> {
  if ((await findTaxRegion(admin, "de")) === undefined) {
    await adminPostJson(admin, "/admin/tax-regions", {
      country_code: "de",
      provider_id: "tp_system",
      default_tax_rate: { rate: 19, code: "DE19", name: "Umsatzsteuer 19 %" },
    });
    return;
  }
  await setDefaultTaxRate(admin, "de", 19);
}
