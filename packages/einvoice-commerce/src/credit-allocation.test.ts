import { describe, expect, it } from "vitest";
import { allocateCreditAcrossRates, CreditExceedsInvoiceError } from "./credit-allocation.js";

// An invoice of 119.00 at 19% and 42.80 at 7%, nothing credited yet.
const UNCREDITED = [
  { rate: "19", gross: "119.00" },
  { rate: "7", gross: "42.80" },
];

describe("allocateCreditAcrossRates (P-65)", () => {
  it("pays for a received return first, at its own rate", () => {
    expect(
      allocateCreditAcrossRates({
        amount: "42.80",
        returns: [{ id: "return_book", byRate: [{ rate: "7", gross: "42.80" }] }],
        uncreditedByRate: UNCREDITED,
      }),
    ).toEqual([{ rate: "7", gross: "42.80", returnId: "return_book" }]);
  });

  it("splits a credit without goods across the rates in proportion to what is uncredited at each", () => {
    // 10.00 over 119.00 : 42.80 → 7.35 / 2.64 rounded down, the cent left to the larger remainder (2.64).
    expect(
      allocateCreditAcrossRates({ amount: "10.00", returns: [], uncreditedByRate: UNCREDITED }),
    ).toEqual([
      { rate: "19", gross: "7.35" },
      { rate: "7", gross: "2.65" },
    ]);
  });

  it("covers returns in the order received, a refund short of a return covering part of it, the rest split", () => {
    const returns = [
      { id: "return_1", byRate: [{ rate: "7", gross: "20.00" }] },
      { id: "return_2", byRate: [{ rate: "19", gross: "50.00" }] },
    ];
    expect(
      allocateCreditAcrossRates({ amount: "15.00", returns, uncreditedByRate: UNCREDITED }),
    ).toEqual([{ rate: "7", gross: "15.00", returnId: "return_1" }]);
    expect(
      allocateCreditAcrossRates({ amount: "80.00", returns, uncreditedByRate: UNCREDITED }),
    ).toEqual([
      { rate: "7", gross: "20.00", returnId: "return_1" },
      { rate: "19", gross: "50.00", returnId: "return_2" },
      // 10.00 left over 69.00 : 22.80 uncredited.
      { rate: "19", gross: "7.52" },
      { rate: "7", gross: "2.48" },
    ]);
  });

  it("never covers a return at a rate beyond what the invoice has left uncredited there", () => {
    expect(
      allocateCreditAcrossRates({
        amount: "30.00",
        returns: [{ id: "return_1", byRate: [{ rate: "7", gross: "45.00" }] }],
        uncreditedByRate: [
          { rate: "19", gross: "119.00" },
          { rate: "7", gross: "12.80" },
        ],
      }),
    ).toEqual([
      { rate: "7", gross: "12.80", returnId: "return_1" },
      { rate: "19", gross: "17.20" },
    ]);
  });

  it("credits the whole remainder of a cancelled invoice at exactly what is uncredited per rate", () => {
    expect(
      allocateCreditAcrossRates({
        amount: "151.80",
        returns: [],
        uncreditedByRate: [
          { rate: "19", gross: "111.64" },
          { rate: "7", gross: "40.16" },
        ],
      }),
    ).toEqual([
      { rate: "19", gross: "111.64" },
      { rate: "7", gross: "40.16" },
    ]);
  });

  it("refuses to credit more than is uncredited", () => {
    expect(() =>
      allocateCreditAcrossRates({ amount: "161.81", returns: [], uncreditedByRate: UNCREDITED }),
    ).toThrow(CreditExceedsInvoiceError);
  });
});
