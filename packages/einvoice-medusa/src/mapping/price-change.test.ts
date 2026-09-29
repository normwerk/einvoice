import { describe, expect, it } from "vitest";
import { describePriceNotice, priceNotices } from "./price-change.js";

const INVOICE = {
  created_at: "2026-09-20T10:00:00Z",
  line_values: [
    { itemId: "item_shirt", unitPrice: "20.0000" },
    { itemId: "item_book", unitPrice: "10.0000" },
  ],
};
const edit = (confirmedAt: string, itemId: string, unitPrice: number) => ({
  confirmed_at: confirmedAt,
  actions: [{ action: "ITEM_UPDATE", details: { reference_id: itemId, unit_price: unitPrice } }],
});

describe("a price an order edit changed after the invoice (T-201)", () => {
  it("notes a lowered and a raised price, each against the price the invoice stated", () => {
    expect(
      priceNotices(INVOICE, [
        edit("2026-09-21T10:00:00Z", "item_shirt", 15),
        edit("2026-09-22T10:00:00Z", "item_book", 12.5),
      ]),
    ).toEqual([
      {
        code: "PRICE_CHANGED_AFTER_INVOICE",
        itemId: "item_shirt",
        invoicedUnitPrice: "20.00",
        newUnitPrice: "15.00",
        direction: "lowered",
      },
      {
        code: "PRICE_CHANGED_AFTER_INVOICE",
        itemId: "item_book",
        invoicedUnitPrice: "10.00",
        newUnitPrice: "12.50",
        direction: "raised",
      },
    ]);
  });

  it("takes the last edit of a line, and none when it went back to the invoiced price", () => {
    const edits = [
      edit("2026-09-21T10:00:00Z", "item_shirt", 15),
      edit("2026-09-23T10:00:00Z", "item_shirt", 20),
    ];
    expect(priceNotices(INVOICE, edits)).toEqual([]);
    expect(priceNotices(INVOICE, [...edits].reverse())).toEqual([]);
  });

  it("ignores an edit confirmed before the invoice, another action, and a quantity-only update", () => {
    expect(
      priceNotices(INVOICE, [
        edit("2026-09-19T10:00:00Z", "item_shirt", 15),
        {
          confirmed_at: "2026-09-21T10:00:00Z",
          actions: [
            { action: "ITEM_ADD", details: { reference_id: "item_shirt", unit_price: 1 } },
            { action: "ITEM_UPDATE", details: { reference_id: "item_book", quantity: 2 } },
          ],
        },
      ]),
    ).toEqual([]);
  });

  it("explains what to do either way", () => {
    const [lowered, raised] = priceNotices(INVOICE, [
      edit("2026-09-21T10:00:00Z", "item_shirt", 15),
      edit("2026-09-21T10:00:00Z", "item_book", 12.5),
    ]);
    if (lowered === undefined || raised === undefined) throw new Error("two notices expected");
    expect(describePriceNotice(lowered, "T-Shirt")).toBe(
      'The unit price of "T-Shirt" was lowered from 20.00 to 15.00 after this invoice was issued. ' +
        "Refunding the difference issues a credit note on this invoice.",
    );
    expect(describePriceNotice(raised)).toMatch(
      /raised from 10\.00 to 12\.50.*additional invoice outside the plugin/,
    );
  });
});
