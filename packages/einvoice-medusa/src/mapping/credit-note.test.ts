import { describe, expect, it } from "vitest";
import type { CommerceInvoiceInput } from "@normwerk/einvoice-commerce" with {
  "resolution-mode": "import",
};
import {
  creditableRefund,
  extractGrossByRateFromCii,
  chooseRefundInvoice,
  invoicedLineValues,
  returnedItemIdsToCredit,
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

  it("values received returns at what the invoice stated for their lines, oldest first, less what earlier credit notes paid", () => {
    // Invoiced: 2 widgets for 238.00 at 19%, 2 books for 21.40 at 7%.
    const invoiced = [
      { itemId: "item_widget", rate: "19", quantity: "2", gross: "238.00" },
      { itemId: "item_book", rate: "7", quantity: "2", gross: "21.40" },
    ];
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
      returnsToCredit(returns, invoiced, [{ returnId: "return_early", rate: "7", gross: "21.40" }]),
    ).toEqual([
      { id: "return_early", byRate: [{ rate: "19", gross: "119.00" }] },
      { id: "return_late", byRate: [{ rate: "19", gross: "119.00" }] },
    ]);
  });

  it("records each order line as the invoice stated it: its item, rate, quantity, gross amount and discount share", () => {
    expect(
      invoicedLineValues(
        [{ itemId: "item_widget", allowance: "4.00" }, { itemId: "item_book" }],
        [
          { quantity: "2", netAmount: "200.00", vat: { rate: "19" } },
          { quantity: "1", netAmount: "10.00", vat: { rate: "7.00" } },
        ],
      ),
    ).toEqual([
      { itemId: "item_widget", rate: "19", quantity: "2", gross: "238.00", allowance: "4.00" },
      { itemId: "item_book", rate: "7", quantity: "1", gross: "10.70" },
    ]);
  });
});

describe("chooseRefundInvoice (P-67)", () => {
  const shirt = { itemId: "item_shirt", rate: "19", quantity: "1", gross: "23.80" };
  const book = { itemId: "item_book", rate: "7", quantity: "1", gross: "10.70" };
  const first = { invoiceId: "inv_1", invoicedLines: [shirt], uncredited: "23.80" };
  const second = { invoiceId: "inv_2", invoicedLines: [book], uncredited: "10.70" };

  it("credits the one invoice with something left, once every unit shipped", () => {
    expect(chooseRefundInvoice([first, { ...second, uncredited: "0.00" }], false, [])).toBe(first);
  });

  it("credits the invoice that holds every received return's goods", () => {
    expect(chooseRefundInvoice([first, second], false, ["item_book"])).toBe(second);
    expect(chooseRefundInvoice([first], true, ["item_shirt"])).toBe(first);
  });

  it("does not guess between invoices, or while part of the order is unshipped", () => {
    expect(chooseRefundInvoice([first, second], false, [])).toBeUndefined();
    expect(chooseRefundInvoice([first], true, [])).toBeUndefined();
    expect(
      chooseRefundInvoice([first, second], false, ["item_shirt", "item_book"]),
    ).toBeUndefined();
  });
});

describe("returnedItemIdsToCredit (P-67)", () => {
  const invoiced = [{ itemId: "item_shirt", rate: "19", quantity: "2", gross: "47.60" }];
  const received = {
    id: "ret_1",
    status: "received",
    received_at: "2026-09-20T10:00:00Z",
    items: [{ item_id: "item_shirt", received_quantity: 1 }],
  };

  it("names the goods of received returns no credit note paid for yet", () => {
    expect(returnedItemIdsToCredit([received], invoiced, [])).toEqual(["item_shirt"]);
    expect(
      returnedItemIdsToCredit([received], invoiced, [
        { returnId: "ret_1", rate: "19", gross: "23.80" },
      ]),
    ).toEqual([]);
    expect(returnedItemIdsToCredit([{ ...received, status: "requested" }], invoiced, [])).toEqual(
      [],
    );
  });
});
