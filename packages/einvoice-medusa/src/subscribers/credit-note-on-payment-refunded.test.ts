import { describe, expect, it } from "vitest";
import {
  extractIssueDateFromCii,
  MissingOriginalInvoiceError,
} from "./credit-note-on-payment-refunded.js";

describe("extractIssueDateFromCii", () => {
  it("parses a real serializeCii-shaped IssueDateTime element (no pretty-print whitespace)", () => {
    const xml =
      "<rsm:ExchangedDocument><ram:TypeCode>380</ram:TypeCode><ram:IssueDateTime>" +
      '<udt:DateTimeString format="102">20260914</udt:DateTimeString>' +
      "</ram:IssueDateTime></rsm:ExchangedDocument>";
    expect(extractIssueDateFromCii(xml)).toBe("2026-09-14");
  });

  it("throws a clear error when no IssueDateTime element is present", () => {
    expect(() => extractIssueDateFromCii("<not-an-invoice/>")).toThrow(/no ram:IssueDateTime/);
  });
});

describe("MissingOriginalInvoiceError", () => {
  it("names the order id in its message", () => {
    const error = new MissingOriginalInvoiceError("order_01");
    expect(error.orderId).toBe("order_01");
    expect(error.message).toMatch(/order_01/);
    expect(error.name).toBe("MissingOriginalInvoiceError");
  });
});
