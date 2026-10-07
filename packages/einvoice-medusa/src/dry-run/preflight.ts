/**
 * T-214: the shop's setup, checked before any order — what decides whether the plugin starts and what it
 * refuses, whatever the orders. Each check reads; none writes. A check that cannot read what it needs says
 * `not-checked` rather than guessing.
 *
 * The plugin options need no check of their own: the plugin refuses to start on incomplete ones
 * (`INVALID_PLUGIN_OPTIONS`), and a dry run runs inside a started Medusa. The same holds for an unsupported
 * Medusa release — the check is there for the report's header to say which release it was.
 */
import { readdirSync } from "node:fs";
import path from "node:path";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import type { MedusaContainer } from "@medusajs/framework";
import type { PreflightCheck } from "@normwerk/einvoice-conformance" with {
  "resolution-mode": "import",
};
import { EINVOICE_MODULE } from "../modules/einvoice/index.js";
import type EinvoiceModuleService from "../modules/einvoice/service.js";
import {
  otherInvoicePlugins,
  type InvoicePluginConfig,
} from "../modules/einvoice/other-invoice-plugins.js";
import {
  describeSupportedMedusaVersions,
  installedMedusaVersion,
  isSupportedMedusaVersion,
} from "../medusa-version.js";

const MIGRATIONS_DIR = path.resolve(__dirname, "../modules/einvoice/migrations");
const FILE_MODULE = "@medusajs/medusa/file";

/** The plugin's migrations, by class name — the name Medusa records once one is applied. */
export function pluginMigrations(dir: string = MIGRATIONS_DIR): readonly string[] {
  return readdirSync(dir)
    .map((file) => /^(Migration\d+)\.(?:js|ts)$/.exec(file)?.[1])
    .filter((name): name is string => name !== undefined)
    .sort();
}

interface Knex {
  raw(sql: string): Promise<{ readonly rows?: readonly { readonly name?: unknown }[] }>;
}

async function migrationsCheck(container: MedusaContainer): Promise<PreflightCheck> {
  try {
    const knex = container.resolve<Knex>(ContainerRegistrationKeys.PG_CONNECTION);
    const { rows } = await knex.raw("select name from mikro_orm_migrations");
    const applied = new Set(
      (rows ?? []).map(({ name }) => String(name).replace(/\.(?:js|ts)$/, "")),
    );
    const pending = pluginMigrations().filter((name) => !applied.has(name));
    return { check: "migrations", status: pending.length === 0 ? "pass" : "fail", pending };
  } catch {
    return { check: "migrations", status: "not-checked", pending: [] };
  }
}

interface TaxRegion {
  readonly country_code?: string | null;
  readonly province_code?: string | null;
  readonly tax_rates?: readonly { readonly rate?: number | string | null }[] | null;
}

/** Countries whose tax region charges no VAT, the seller's own among them when it has no region at all — a
 * failure for the seller's (every domestic order refused), listed for another. */
async function taxRatesCheck(
  container: MedusaContainer,
  sellerCountry: string,
): Promise<PreflightCheck> {
  try {
    const query = container.resolve(ContainerRegistrationKeys.QUERY);
    const { data } = await query.graph({
      entity: "tax_region",
      fields: ["country_code", "province_code", "tax_rates.rate"],
    });
    const countries = (data as unknown as TaxRegion[]).filter(
      (region) => region.province_code === null || region.province_code === undefined,
    );
    const charging = new Set(
      countries
        .filter((region) => (region.tax_rates ?? []).some((rate) => Number(rate.rate ?? 0) > 0))
        .map((region) => String(region.country_code).toUpperCase()),
    );
    const withoutVat = [
      ...new Set([
        ...countries.map((region) => String(region.country_code).toUpperCase()),
        sellerCountry.toUpperCase(),
      ]),
    ]
      .filter((country) => !charging.has(country))
      .sort();
    const seller = sellerCountry.toUpperCase();
    return {
      check: "tax-rates",
      status: withoutVat.includes(seller) ? "fail" : "pass",
      sellerCountry: seller,
      withoutVat,
    };
  } catch {
    return {
      check: "tax-rates",
      status: "not-checked",
      sellerCountry: sellerCountry.toUpperCase(),
      withoutVat: [],
    };
  }
}

interface ModuleEntry {
  readonly resolve?: unknown;
  readonly options?: { readonly providers?: readonly { readonly resolve?: unknown }[] };
}

/** The File Module's provider in Medusa's loaded configuration — it keys modules by name, or lists them. */
export function fileProvider(config: InvoicePluginConfig | undefined): string | null {
  const modules = config?.modules;
  const entries: readonly ModuleEntry[] = Array.isArray(modules)
    ? (modules as ModuleEntry[])
    : typeof modules === "object" && modules !== null
      ? Object.entries(modules as Record<string, ModuleEntry>).map(([key, entry]) =>
          key === "file" && typeof entry === "object" ? { resolve: FILE_MODULE, ...entry } : entry,
        )
      : [];
  const file = entries.find((entry) => entry.resolve === FILE_MODULE);
  const provider = file?.options?.providers?.[0]?.resolve;
  return typeof provider === "string" ? provider : null;
}

export async function checkPreflight(
  container: MedusaContainer,
  appRoot: string = process.cwd(),
): Promise<readonly PreflightCheck[]> {
  const einvoiceService = container.resolve<EinvoiceModuleService>(EINVOICE_MODULE);
  const config = container.resolve<InvoicePluginConfig | undefined>(
    ContainerRegistrationKeys.CONFIG_MODULE,
  );
  const installed = installedMedusaVersion(appRoot) ?? null;
  const plugins = otherInvoicePlugins(config);
  const provider = fileProvider(config);
  const verifier = einvoiceService.options.vatIdVerifier !== undefined;
  return [
    {
      check: "platform-version",
      status: installed !== null && isSupportedMedusaVersion(installed) ? "pass" : "fail",
      installed,
      supported: describeSupportedMedusaVersions(),
    },
    await migrationsCheck(container),
    { check: "plugin-options", status: "pass", invalid: [] },
    await taxRatesCheck(container, einvoiceService.options.seller.countryCode),
    { check: "other-invoice-plugins", status: plugins.length === 0 ? "pass" : "warn", plugins },
    { check: "file-storage", status: provider === null ? "fail" : "pass", provider },
    { check: "vat-id-verifier", status: verifier ? "pass" : "warn", configured: verifier },
  ];
}
