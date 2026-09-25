import { describe, expect, it } from "vitest";
import {
  buyerCountrySupport,
  describeSupport,
  SUPPORTED_SELLER_COUNTRIES,
} from "./supported-jurisdictions.js";

describe("supported jurisdictions (T-077)", () => {
  it("supports a seller in Germany only", () => {
    expect(SUPPORTED_SELLER_COUNTRIES).toEqual(["DE"]);
  });

  it("serves Germany, the EU/EEA, Switzerland and the UK with EN 16931, and refuses Italy and Poland", () => {
    for (const country of ["DE", "FR", "AT", "NO", "IS", "LI", "CH", "GB"] as const) {
      expect(buyerCountrySupport(country)).toBe("en16931");
    }
    expect(buyerCountrySupport("IT")).toBe("clearance-unsupported");
    expect(buyerCountrySupport("PL")).toBe("clearance-unsupported");
    expect(buyerCountrySupport("US")).toBe("unsupported");
  });

  it("describes what is supported in one line, without anything planned", () => {
    const line = describeSupport();
    expect(line).toContain("seller DE");
    expect(line).toContain("not supported: IT, PL");
    expect(line).not.toMatch(/planned|0\.2/i);
  });
});
