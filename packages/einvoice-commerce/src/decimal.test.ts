import { describe, expect, it } from "vitest";
import {
  apportionAmount,
  compareAmounts,
  compareDecimals,
  isZeroAmount,
  multiplyToAmount,
  netsOfVatInclusiveParts,
  percentOfAmount,
  subtractAmounts,
  sumAmounts,
  unitPriceOf,
  vatContainedIn,
} from "./decimal.js";

describe("decimal.ts — exact arithmetic, BR-CO-* rounding (ties towards +Infinity)", () => {
  it("sums and subtracts without floating-point drift", () => {
    expect(sumAmounts(["0.10", "0.20"])).toBe("0.30"); // 0.1+0.2 !== 0.3 in IEEE754 — the whole point of this module
    expect(subtractAmounts("1.00", "0.30")).toBe("0.70");
  });

  it("multiplies quantity × price and rounds to 2dp on a tie, towards positive infinity", () => {
    expect(multiplyToAmount("2", "50.00")).toBe("100.00");
    expect(multiplyToAmount("0.5", "0.05")).toBe("0.03"); // 0.025 exactly — real BR-CO tie case
  });

  it("computes basisAmount × (percent/100), rounded to 2dp — BR-CO-17's own formula", () => {
    expect(percentOfAmount("105.00", "19")).toBe("19.95");
    expect(percentOfAmount("40.00", "7")).toBe("2.80");
    expect(percentOfAmount("1.00", "12.5")).toBe("0.13"); // 0.125 exactly — tie rounds up
  });

  it("isZeroAmount / compareAmounts", () => {
    expect(isZeroAmount("0.00")).toBe(true);
    expect(isZeroAmount("0.01")).toBe(false);
    expect(compareAmounts("1.00", "1.00")).toBe(0);
    expect(compareAmounts("1.00", "1.01")).toBe(-1);
    expect(compareAmounts("1.01", "1.00")).toBe(1);
  });

  it("subtractAmounts refuses to go negative", () => {
    expect(() => subtractAmounts("1.00", "2.00")).toThrow();
  });
});

describe("VAT-inclusive amounts (P-61)", () => {
  it("vatContainedIn takes the VAT out of a gross amount, rounded to the cent", () => {
    expect(vatContainedIn("20.00", "19")).toBe("3.19"); // 20.00 × 19/119 = 3.1932…
    expect(vatContainedIn("10.00", "19")).toBe("1.60"); // 1.5966…
    expect(vatContainedIn("10.70", "7")).toBe("0.70");
    expect(vatContainedIn("12.00", "20")).toBe("2.00");
    expect(vatContainedIn("100.00", "0")).toBe("0.00");
    expect(vatContainedIn("10.55", "5.5")).toBe("0.55");
  });

  it("netsOfVatInclusiveParts spreads a group's net over its parts so they add up exactly", () => {
    // Two 10.00 parts at 19%: 8.4034 each rounds to 8.40, but the group's net is 20.00 − 3.19 = 16.81.
    expect(
      netsOfVatInclusiveParts([{ amount: "10.00" }, { amount: "10.00" }], "19", "16.81"),
    ).toEqual(["8.41", "8.40"]);
    // The cent goes to the part rounding moved down the most (8.4034 → 8.40), not simply the first
    // (25.2101 → 25.21): 50.00 gross holds 7.98 VAT, so the net is 42.02, one cent above 25.21 + 8.40 + 8.40.
    expect(
      netsOfVatInclusiveParts(
        [{ amount: "30.00" }, { amount: "10.00" }, { amount: "10.00" }],
        "19",
        "42.02",
      ),
    ).toEqual(["25.21", "8.41", "8.40"]);
    // A subtracted part (a discount) keeps its own rounded net; the added parts absorb the difference.
    expect(
      netsOfVatInclusiveParts(
        [{ amount: "30.00" }, { amount: "10.00" }, { amount: "3.00", negative: true }],
        "19",
        "31.09",
      ),
    ).toEqual(["25.21", "8.40", "2.52"]);
    expect(netsOfVatInclusiveParts([{ amount: "5.00" }], "0", "5.00")).toEqual(["5.00"]);
  });

  it("unitPriceOf divides a line amount by its quantity to 4 decimals", () => {
    expect(unitPriceOf("25.21", "3")).toBe("8.4033");
    expect(unitPriceOf("8.41", "1")).toBe("8.4100");
    expect(unitPriceOf("10.00", "1.5")).toBe("6.6667");
  });

  it("compareDecimals compares rates of any scale", () => {
    expect(compareDecimals("19", "19.000")).toBe(0);
    expect(compareDecimals("5.5", "7")).toBe(-1);
    expect(compareDecimals("20", "19.99")).toBe(1);
  });
});

describe("apportionAmount (P-65)", () => {
  it("splits in proportion, the cents left over to the largest remainders, summing to exactly the total", () => {
    expect(apportionAmount("10.00", ["100.00", "40.00"])).toEqual(["7.14", "2.86"]);
    expect(apportionAmount("0.01", ["1.00", "1.00", "1.00"])).toEqual(["0.01", "0.00", "0.00"]);
    expect(apportionAmount("1.00", ["1.00", "1.00", "1.00"])).toEqual(["0.34", "0.33", "0.33"]);
  });

  it("gives a zero weight nothing, and refuses when every weight is zero", () => {
    expect(apportionAmount("5.00", ["0.00", "20.00"])).toEqual(["0.00", "5.00"]);
    expect(() => apportionAmount("5.00", ["0.00", "0.00"])).toThrow(/non-zero weight/);
  });
});
