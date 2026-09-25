import { describe, expect, it } from "vitest";
import { otherInvoicePlugins } from "./other-invoice-plugins.js";

describe("otherInvoicePlugins (P-68)", () => {
  it("finds a known invoice plugin listed as a plugin, by name or with options", () => {
    expect(otherInvoicePlugins({ plugins: ["@webbers/invoices-medusa"] })).toEqual([
      "@webbers/invoices-medusa",
    ]);
    expect(
      otherInvoicePlugins({ plugins: [{ resolve: "@webbers/invoices-medusa", options: {} }] }),
    ).toEqual(["@webbers/invoices-medusa"]);
  });

  it("finds its module registered directly, as Medusa merges a plugin's modules into the config", () => {
    expect(
      otherInvoicePlugins({
        modules: {
          invoice: { resolve: "@webbers/invoices-medusa/.medusa/server/src/modules/invoice" },
        },
      }),
    ).toEqual(["@webbers/invoices-medusa"]);
  });

  it("names a plugin once, and nothing without one", () => {
    expect(
      otherInvoicePlugins({
        plugins: ["@webbers/invoices-medusa"],
        modules: {
          invoice: { resolve: "@webbers/invoices-medusa/.medusa/server/src/modules/invoice" },
        },
      }),
    ).toEqual(["@webbers/invoices-medusa"]);
    expect(
      otherInvoicePlugins({
        plugins: ["@normwerk/einvoice-medusa", { resolve: "@webbers/invoices-medusa-extra" }],
        modules: { einvoice: { resolve: "./src/modules/einvoice" }, cache: true },
      }),
    ).toEqual([]);
    expect(otherInvoicePlugins(undefined)).toEqual([]);
  });
});
