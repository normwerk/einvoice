import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  errorCodeOf,
  errorDocsUrl,
  PluginError,
  supportRequestUrl,
  ERROR_REFERENCE_URL,
} from "./errors.js";

describe("plugin errors (T-077)", () => {
  it("links a code exactly as the core packages do", async () => {
    const model = await import("@normwerk/einvoice-model");
    expect(ERROR_REFERENCE_URL).toBe(model.ERROR_REFERENCE_URL);
    for (const code of ["MISSING_ORIGINAL_INVOICE", "UNSUPPORTED_SELLER_COUNTRY"]) {
      expect(errorDocsUrl(code)).toBe(model.errorDocsUrl(code));
    }
  });

  it("carries a code and its link", () => {
    const error = new PluginError("MISSING_BUYER_COUNTRY", "no country");
    expect(error).toMatchObject({
      code: "MISSING_BUYER_COUNTRY",
      docsUrl: "https://normwerk.dev/einvoice/docs/errors#missing-buyer-country",
      message: "no country",
    });
  });

  it("reads the code of a core package's error, and calls anything else INTERNAL_ERROR", async () => {
    const commerce = await import("@normwerk/einvoice-commerce");
    expect(errorCodeOf(new commerce.UnsupportedCountryError("IT", "clearance-model")).code).toBe(
      "UNSUPPORTED_BUYER_COUNTRY_CLEARANCE",
    );
    expect(errorCodeOf(new Error("boom"))).toEqual({
      code: "INTERNAL_ERROR",
      docsUrl: "https://normwerk.dev/einvoice/docs/errors#internal-error",
    });
    expect(errorCodeOf(undefined).code).toBe("INTERNAL_ERROR");
  });

  it("fills in the country form with the countries and nothing about the order (T-209)", () => {
    const url = new URL(supportRequestUrl({ seller: "DE", buyer: "IT" }));
    expect(url.origin + url.pathname).toBe("https://github.com/normwerk/einvoice/issues/new");
    // The form, not a blank issue: the form sets the `country-request` label.
    expect(url.searchParams.get("template")).toBe("country.yml");
    expect(url.searchParams.get("title")).toBe("Support for buyer country IT");
    expect(url.searchParams.get("seller")).toBe("DE");
    expect(url.searchParams.get("buyer")).toBe("IT");
    expect(url.searchParams.get("context")).toContain("A buyer in IT");
    expect([...url.searchParams.keys()].sort()).toEqual([
      "buyer",
      "context",
      "seller",
      "template",
      "title",
    ]);
  });

  it("leaves the buyer to the merchant when the seller's country is the one asked for (T-209)", () => {
    const url = new URL(supportRequestUrl({ seller: "FR" }));
    expect(url.searchParams.get("title")).toBe("Support for seller country FR");
    expect(url.searchParams.get("seller")).toBe("FR");
    expect(url.searchParams.has("buyer")).toBe(false);
    expect(url.searchParams.get("context")).toContain("A seller in FR");
  });

  it("prefills only fields the country form has, by their ids (T-209)", () => {
    // `__dirname`, not `import.meta.url`: this package compiles to CommonJS (see medusa-version.test.ts).
    const form = readFileSync(
      resolve(__dirname, "../../../.github/ISSUE_TEMPLATE/country.yml"),
      "utf8",
    );
    const ids = [...form.matchAll(/^\s+id: (\S+)$/gm)].map((match) => match[1]);
    const url = new URL(supportRequestUrl({ seller: "DE", buyer: "IT" }));
    const fields = [...url.searchParams.keys()].filter(
      (key) => !["template", "title"].includes(key),
    );
    expect(fields.every((field) => ids.includes(field))).toBe(true);
    expect(form).toContain('labels: ["country-request"]');
  });
});
