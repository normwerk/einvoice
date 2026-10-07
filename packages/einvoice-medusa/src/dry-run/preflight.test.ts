import { describe, expect, it, vi } from "vitest";
import type { MedusaContainer } from "@medusajs/framework";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { EINVOICE_MODULE } from "../modules/einvoice/index.js";
import { checkPreflight, fileProvider, pluginMigrations } from "./preflight.js";

function makeContainer({
  taxRegions = [],
  applied = pluginMigrations(),
  config = {},
  vatIdVerifier,
}: {
  readonly taxRegions?: readonly unknown[];
  readonly applied?: readonly string[];
  readonly config?: unknown;
  readonly vatIdVerifier?: unknown;
}): MedusaContainer {
  const registry = new Map<unknown, unknown>([
    [EINVOICE_MODULE, { options: { seller: { countryCode: "DE" }, vatIdVerifier } }],
    [ContainerRegistrationKeys.QUERY, { graph: vi.fn(async () => ({ data: taxRegions })) }],
    [
      ContainerRegistrationKeys.PG_CONNECTION,
      { raw: vi.fn(async () => ({ rows: applied.map((name) => ({ name })) })) },
    ],
    [ContainerRegistrationKeys.CONFIG_MODULE, config],
  ]);
  return { resolve: (key: unknown) => registry.get(key) } as unknown as MedusaContainer;
}

const GERMANY = { country_code: "de", province_code: null, tax_rates: [{ rate: 19 }] };

describe("checkPreflight (T-214)", () => {
  it("knows the plugin's migrations by name", () => {
    expect(pluginMigrations()).toContain("Migration20260915095829");
  });

  it("names the migrations not applied yet", async () => {
    const [, migrations] = await checkPreflight(
      makeContainer({ taxRegions: [GERMANY], applied: [] }),
    );

    expect(migrations).toMatchObject({ check: "migrations", status: "fail" });
    expect(migrations).toHaveProperty("pending", pluginMigrations());
  });

  it("fails the VAT rates when the seller's country charges none, and warns for another country", async () => {
    const zero = { country_code: "at", province_code: null, tax_rates: [{ rate: 0 }] };

    const checks = await checkPreflight(makeContainer({ taxRegions: [zero] }));

    expect(checks.find(({ check }) => check === "tax-rates")).toEqual({
      check: "tax-rates",
      status: "fail",
      withoutVat: ["AT", "DE"],
    });
    const warned = await checkPreflight(makeContainer({ taxRegions: [GERMANY, zero] }));
    expect(warned.find(({ check }) => check === "tax-rates")).toMatchObject({
      status: "warn",
      withoutVat: ["AT"],
    });
  });

  it("warns of another invoice plugin and of a missing VAT-ID verifier", async () => {
    const checks = await checkPreflight(
      makeContainer({ taxRegions: [GERMANY], config: { plugins: ["@webbers/invoices-medusa"] } }),
    );

    expect(checks.find(({ check }) => check === "other-invoice-plugins")).toEqual({
      check: "other-invoice-plugins",
      status: "warn",
      plugins: ["@webbers/invoices-medusa"],
    });
    expect(checks.find(({ check }) => check === "vat-id-verifier")).toEqual({
      check: "vat-id-verifier",
      status: "warn",
      configured: false,
    });
  });
});

describe("fileProvider (T-214)", () => {
  it("reads the File Module's provider from modules keyed by name or listed", () => {
    const providers = { providers: [{ resolve: "@medusajs/medusa/file-s3", id: "s3" }] };

    expect(
      fileProvider({ modules: { file: { resolve: "@medusajs/medusa/file", options: providers } } }),
    ).toBe("@medusajs/medusa/file-s3");
    expect(
      fileProvider({ modules: [{ resolve: "@medusajs/medusa/file", options: providers }] }),
    ).toBe("@medusajs/medusa/file-s3");
    expect(fileProvider({ modules: {} })).toBeNull();
  });
});
