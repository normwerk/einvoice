import { describe, expect, it } from "vitest";
import {
  buyerCountrySupport,
  describeSupport,
  specialVatTerritory,
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

  it("recognises a special VAT territory by its member state's code and postcode (T-195)", () => {
    const cases = [
      ["DE", "27498", "Heligoland"],
      ["DE", "78266", "Büsingen am Hochrhein"],
      ["ES", "35001", "the Canary Islands"],
      ["ES", "38 300", "the Canary Islands"],
      ["ES", "E-35100", "the Canary Islands"],
      ["ES", "51001", "Ceuta"],
      ["ES", "52001", "Melilla"],
      ["FI", "AX-22100", "the Åland Islands"],
      ["FR", "97100", "a French overseas department or territory"],
      ["FR", "98714", "a French overseas department or territory"],
      ["GR", "63086", "Mount Athos"],
      ["IT", "23041", "Livigno"],
      ["IT", "22061", "Campione d'Italia"],
      ["GB", "bt1 1aa", "Northern Ireland"],
      ["XI", undefined, "Northern Ireland"],
    ] as const;
    for (const [country, postCode, name] of cases) {
      expect(specialVatTerritory(country, postCode)?.name, `${country} ${postCode}`).toBe(name);
    }
    expect(specialVatTerritory("GB", "BT1 1AA")?.goodsOnly).toBe(true);
    expect(specialVatTerritory("ES", "35001")?.goodsOnly).toBe(false);
  });

  it("leaves the rest of each member state alone — including Monaco's French postcode (T-195)", () => {
    const cases = [
      ["DE", "27499"],
      ["DE", "10115"],
      ["ES", "28001"],
      ["ES", "53001"],
      ["FI", "00100"],
      ["FR", "75008"],
      ["FR", "98000"],
      ["GR", "63085"],
      ["IT", "23040"],
      ["GB", "SW1A 1AA"],
      ["GB", "B1 1AA"],
      ["CH", "8238"],
      ["FR", undefined],
    ] as const;
    for (const [country, postCode] of cases) {
      expect(specialVatTerritory(country, postCode), `${country} ${postCode}`).toBeUndefined();
    }
  });

  it("describes what is supported in one line, without anything planned", () => {
    const line = describeSupport();
    expect(line).toContain("seller DE");
    expect(line).toContain("not supported: IT, PL");
    expect(line).not.toMatch(/planned|0\.2/i);
  });
});
