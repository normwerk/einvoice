import { describe, expect, it } from "vitest";
import {
  compareAmounts,
  isZeroAmount,
  multiplyToAmount,
  percentOfAmount,
  subtractAmounts,
  sumAmounts,
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
