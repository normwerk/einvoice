import { describe, expect, it } from "vitest";
import { EinvoiceError, errorDocsUrl, ERROR_REFERENCE_URL } from "./index.js";

describe("EinvoiceError (T-077)", () => {
  it("carries a stable code and the published explanation of it", () => {
    const error = new EinvoiceError("VAT_ID_UNVERIFIED", "needs a positive VIES check");
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe("VAT_ID_UNVERIFIED");
    expect(error.message).toBe("needs a positive VIES check");
    expect(error.docsUrl).toBe(`${ERROR_REFERENCE_URL}#vat-id-unverified`);
  });

  it("anchors a code in lower case with hyphens", () => {
    expect(errorDocsUrl("UNSUPPORTED_BUYER_COUNTRY_CLEARANCE")).toBe(
      "https://normwerk.dev/einvoice/docs/errors#unsupported-buyer-country-clearance",
    );
  });
});
