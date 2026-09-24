import { describe, expect, it } from "vitest";
import type { CommerceInvoiceInput } from "@normwerk/einvoice-commerce" with {
  "resolution-mode": "import",
};
import {
  creditableRefund,
  decideCreditScope,
  extractGrandTotalFromCii,
  extractIssueDateFromCii,
  toPartialCreditNoteInput,
} from "./credit-note.js";

describe("decideCreditScope (P-41)", () => {
  it("reverses the whole invoice when the first refund returns all of it", () => {
    expect(
      decideCreditScope({
        requested: "119.00",
        invoiceTotal: "119.00",
        creditedTotals: [],
        tolerance: "0.02",
      }),
    ).toEqual({ kind: "full" });
  });

  it("treats a refund within rounding of the invoice total as full (gross-priced shops differ by a cent)", () => {
    expect(
      decideCreditScope({
        requested: "29.97",
        invoiceTotal: "29.98",
        creditedTotals: [],
        tolerance: "0.04",
      }),
    ).toEqual({ kind: "full" });
  });

  it("credits a partial refund for exactly its own amount", () => {
    expect(
      decideCreditScope({
        requested: "10.00",
        invoiceTotal: "119.00",
        creditedTotals: [],
        tolerance: "0.02",
      }),
    ).toEqual({ kind: "partial", gross: "10.00" });
  });

  it("never credits more than is still outstanding — two refunds of 60 on an invoice of 100", () => {
    expect(
      decideCreditScope({
        requested: "60.00",
        invoiceTotal: "100.00",
        creditedTotals: ["60.00"],
        tolerance: "0.02",
      }),
    ).toEqual({ kind: "partial", gross: "40.00" });
  });

  it("credits nothing once the invoice is fully credited", () => {
    expect(
      decideCreditScope({
        requested: "10.00",
        invoiceTotal: "100.00",
        creditedTotals: ["100.00"],
        tolerance: "0.02",
      }),
    ).toEqual({ kind: "none" });
  });

  it("does not restate the whole order once part of it is credited, even if the rest is refunded", () => {
    expect(
      decideCreditScope({
        requested: "90.00",
        invoiceTotal: "100.00",
        creditedTotals: ["10.00"],
        tolerance: "0.02",
      }),
    ).toEqual({ kind: "partial", gross: "90.00" });
  });
});

describe("creditableRefund (P-63)", () => {
  // An intra-EU invoice of 100.00 at 0%, where Medusa charged 120.00: the buyer overpaid 20.00.
  const overpaid = "20.00";

  it("credits nothing for a refund that returns the overpayment — the invoice is correct as it stands", () => {
    expect(
      creditableRefund({ refund: "20.00", refundedBefore: "0.00", creditedTotals: [], overpaid }),
    ).toBe("0.00");
  });

  it("credits only what a refund returns beyond the overpayment", () => {
    expect(
      creditableRefund({ refund: "30.00", refundedBefore: "0.00", creditedTotals: [], overpaid }),
    ).toBe("10.00");
    // The whole payment back: the invoice total is credited.
    expect(
      creditableRefund({ refund: "120.00", refundedBefore: "0.00", creditedTotals: [], overpaid }),
    ).toBe("100.00");
  });

  it("counts earlier refunds that credited nothing as the overpayment already returned", () => {
    expect(
      creditableRefund({ refund: "50.00", refundedBefore: "20.00", creditedTotals: [], overpaid }),
    ).toBe("50.00");
    // 30 refunded before, 10 of it credited: the overpayment is back, this refund is all credit.
    expect(
      creditableRefund({
        refund: "15.00",
        refundedBefore: "30.00",
        creditedTotals: ["10.00"],
        overpaid,
      }),
    ).toBe("15.00");
  });

  it("credits the whole refund when the invoice has no overpayment", () => {
    expect(
      creditableRefund({
        refund: "25.00",
        refundedBefore: "0.00",
        creditedTotals: [],
        overpaid: "0.00",
      }),
    ).toBe("25.00");
  });
});

describe("toPartialCreditNoteInput (P-41)", () => {
  const INPUT = {
    schemaVersion: 1,
    document: { kind: "credit-note", issueDate: "2026-09-23", currency: "EUR" },
    lines: [
      { identifier: "1", quantity: "2", unitCode: "C62", netPrice: "50.00", itemName: "Widget" },
      { identifier: "2", quantity: "1", unitCode: "C62", netPrice: "20.00", itemName: "Gadget" },
    ],
    shipping: { amount: "10.00", reason: "Versand / Shipping" },
    taxContext: { supplyType: "goods" },
  } as unknown as CommerceInvoiceInput;

  it("replaces the order's lines, shipping and discounts with one VAT-inclusive line for the credited sum", () => {
    const result = toPartialCreditNoteInput(INPUT, {
      gross: "10.00",
      taxRateKind: "standard",
      chargedVatRate: undefined,
      originalInvoiceNumber: "RE-2026-0007",
    });
    expect(result.lines).toEqual([
      {
        identifier: "1",
        quantity: "1",
        unitCode: "C62",
        priceInclVat: "10.00",
        itemName: "Teilerstattung / Partial refund — Rechnung RE-2026-0007",
        taxRateKind: "standard",
        chargedVatRate: undefined,
        supplyType: "goods",
      },
    ]);
    expect(result.shipping).toBeUndefined();
    expect(result.discounts).toBeUndefined();
    expect(result.document).toBe(INPUT.document);
  });
});

describe("reading an already generated CII invoice back (P-41)", () => {
  const XML =
    '<rsm:ExchangedDocument><ram:IssueDateTime><udt:DateTimeString format="102">20260915</udt:DateTimeString></ram:IssueDateTime></rsm:ExchangedDocument>' +
    "<ram:SpecifiedTradeSettlementHeaderMonetarySummation><ram:GrandTotalAmount>23.80</ram:GrandTotalAmount></ram:SpecifiedTradeSettlementHeaderMonetarySummation>";

  it("extracts the issue date (BT-2) and the grand total (BT-112)", () => {
    expect(extractIssueDateFromCii(XML)).toBe("2026-09-15");
    expect(extractGrandTotalFromCii(XML)).toBe("23.80");
  });

  it("refuses to guess when the grand total is missing", () => {
    expect(() => extractGrandTotalFromCii("<rsm:CrossIndustryInvoice/>")).toThrow(
      /GrandTotalAmount/,
    );
  });
});
