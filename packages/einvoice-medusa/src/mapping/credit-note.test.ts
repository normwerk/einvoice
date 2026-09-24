import { describe, expect, it } from "vitest";
import type { CommerceInvoiceInput } from "@normwerk/einvoice-commerce" with {
  "resolution-mode": "import",
};
import {
  creditableRefund,
  extractGrossByRateFromCii,
  returnsToCredit,
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
    const result = toPartialCreditNoteInput(
      INPUT,
      [
        {
          gross: "10.00",
          taxRateKind: "standard",
          chargedVatRate: undefined,
          label: "Teilerstattung / Partial refund",
        },
      ],
      "RE-2026-0007",
    );
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

describe("reading a document's amounts per rate back, and the returns still to credit (P-65)", () => {
  it("adds up each rate's taxable amount and tax from the BG-23 breakdown, skipping line-level taxes", () => {
    const xml =
      "<ram:ApplicableTradeTax><ram:TypeCode>VAT</ram:TypeCode><ram:CategoryCode>S</ram:CategoryCode>" +
      "<ram:RateApplicablePercent>7</ram:RateApplicablePercent></ram:ApplicableTradeTax>" +
      "<ram:ApplicableTradeTax><ram:CalculatedAmount>19.68</ram:CalculatedAmount><ram:TypeCode>VAT</ram:TypeCode>" +
      "<ram:BasisAmount>103.57</ram:BasisAmount><ram:CategoryCode>S</ram:CategoryCode>" +
      "<ram:RateApplicablePercent>19</ram:RateApplicablePercent></ram:ApplicableTradeTax>" +
      "<ram:ApplicableTradeTax><ram:CalculatedAmount>2.90</ram:CalculatedAmount><ram:TypeCode>VAT</ram:TypeCode>" +
      "<ram:BasisAmount>41.43</ram:BasisAmount><ram:CategoryCode>S</ram:CategoryCode>" +
      "<ram:RateApplicablePercent>7.00</ram:RateApplicablePercent></ram:ApplicableTradeTax>";
    expect(extractGrossByRateFromCii(xml)).toEqual([
      { rate: "19", gross: "123.25" },
      { rate: "7", gross: "44.33" },
    ]);
    expect(() => extractGrossByRateFromCii("<rsm:CrossIndustryInvoice/>")).toThrow(
      /no VAT breakdown/,
    );
  });

  it("values received returns at their lines' gross price, oldest first, less what earlier credit notes paid", () => {
    // Units received back so far, over every return: 2 widgets (119.00 each), 2 books (10.70 each).
    const items = [
      { id: "item_widget", return_received_total: 238, detail: { return_received_quantity: 2 } },
      { id: "item_book", return_received_total: 21.4, detail: { return_received_quantity: 2 } },
    ];
    const rateOfItem = (id: string): string | undefined =>
      ({ item_widget: "19", item_book: "7" })[id];
    const returns = [
      {
        id: "return_late",
        status: "received",
        received_at: "2026-02-01T10:00:00Z",
        items: [{ item_id: "item_widget", received_quantity: 1 }],
      },
      {
        id: "return_early",
        status: "partially_received",
        received_at: null,
        created_at: "2026-01-20T10:00:00Z",
        items: [
          { item_id: "item_book", received_quantity: 2 },
          { item_id: "item_widget", received_quantity: 1 },
        ],
      },
      { id: "return_open", status: "requested", received_at: null, items: [] },
    ];
    expect(
      returnsToCredit(returns, items, rateOfItem, [
        { returnId: "return_early", rate: "7", gross: "21.40" },
      ]),
    ).toEqual([
      { id: "return_early", byRate: [{ rate: "19", gross: "119.00" }] },
      { id: "return_late", byRate: [{ rate: "19", gross: "119.00" }] },
    ]);
  });
});
