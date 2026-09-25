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

  it("fills in a support request with the country and nothing about the order", () => {
    const url = new URL(supportRequestUrl("buyer", "IT"));
    expect(url.origin + url.pathname).toBe("https://github.com/normwerk/einvoice/issues/new");
    expect(url.searchParams.get("title")).toBe("Support for buyer country IT");
    expect(url.searchParams.get("body")).toContain("A buyer in IT");
  });
});
