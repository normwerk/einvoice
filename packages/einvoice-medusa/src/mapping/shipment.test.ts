import { describe, expect, it } from "vitest";
import {
  shipmentLines,
  ShipmentLineUnknownError,
  ShipmentItemWithoutLineError,
  ShipmentQuantityUnknownError,
  type MedusaFulfillment,
  type MedusaOrderChange,
} from "./shipment.js";
import type { MedusaOrderLineItem } from "./order-to-commerce-invoice-input.js";

/** Three units at 10.00 net with a promotion of 1.00 on the line. */
const LINE: MedusaOrderLineItem = {
  id: "item_1",
  title: "Widget",
  unit_price: 10,
  is_tax_inclusive: false,
  detail: { quantity: 3 },
  discount_subtotal: 1,
  discount_total: 1.19,
};

/** The order's record of an ordinary fulfillment: each line's units as the fulfillment lists them. */
function recorded(fulfillment: MedusaFulfillment): readonly MedusaOrderChange[] {
  return [
    {
      actions: (fulfillment.items ?? []).map((item) => ({
        action: "FULFILL_ITEM",
        reference_id: fulfillment.id,
        details: { reference_id: item.line_item_id, quantity: item.quantity },
      })),
    },
  ];
}

/** `shipmentLines` for an ordinary fulfillment, recorded as it lists its lines. */
function linesOf(
  items: readonly MedusaOrderLineItem[],
  fulfillment: MedusaFulfillment,
  invoicedBefore: Parameters<typeof shipmentLines>[3],
): ReturnType<typeof shipmentLines> {
  return shipmentLines(items, fulfillment, recorded(fulfillment), invoicedBefore);
}

describe("shipmentLines (P-67)", () => {
  it("invoices what the fulfillment shipped, with its share of the line discount", () => {
    expect(
      linesOf([LINE], { id: "ful_1", items: [{ line_item_id: "item_1", quantity: 1 }] }, []),
    ).toEqual([{ itemId: "item_1", quantity: "1", allowance: "0.33" }]);
  });

  it("gives the shipment that completes a line what is left of its discount, to the cent", () => {
    const first = linesOf(
      [LINE],
      { id: "ful_1", items: [{ line_item_id: "item_1", quantity: 1 }] },
      [],
    );
    const second = linesOf(
      [LINE],
      { id: "ful_2", items: [{ line_item_id: "item_1", quantity: 1 }] },
      first,
    );
    const third = linesOf(
      [LINE],
      { id: "ful_3", items: [{ line_item_id: "item_1", quantity: 1 }] },
      [...first, ...second],
    );
    expect([first, second, third].map((lines) => lines[0]?.allowance)).toEqual([
      "0.33",
      "0.33",
      "0.34",
    ]);
  });

  it("takes a tax-inclusive line's discount including VAT", () => {
    const gross = { ...LINE, is_tax_inclusive: true };
    expect(
      linesOf([gross], { id: "ful_1", items: [{ line_item_id: "item_1", quantity: 3 }] }, [])[0]
        ?.allowance,
    ).toBe("1.19");
  });

  it("scales Medusa's discount back to the ordered quantity after a return", () => {
    // One unit came back: Medusa now states the discount for the two units the buyer kept.
    const afterReturn: MedusaOrderLineItem = {
      ...LINE,
      detail: { quantity: 3, return_received_quantity: 1 },
      discount_subtotal: 0.67,
    };
    expect(
      linesOf(
        [afterReturn],
        { id: "ful_1", items: [{ line_item_id: "item_1", quantity: 1 }] },
        [],
      )[0]?.allowance,
    ).toBe("0.34");
  });

  it("takes a set's units from the order's record, not from its parts: a table and four chairs is one set (T-202)", () => {
    // Stock managed: Medusa ships a fulfillment item per inventory item, units times required_quantity.
    const set: MedusaOrderLineItem = { ...LINE, detail: { quantity: 1 }, discount_subtotal: 0 };
    const fulfillment: MedusaFulfillment = {
      id: "ful_1",
      items: [
        { line_item_id: "item_1", quantity: 1 },
        { line_item_id: "item_1", quantity: 4 },
      ],
    };
    const changes: readonly MedusaOrderChange[] = [
      {
        actions: [
          {
            action: "SHIP_ITEM",
            reference_id: "ful_1",
            details: { reference_id: "item_1", quantity: 1 },
          },
        ],
      },
      {
        actions: [
          {
            action: "FULFILL_ITEM",
            reference_id: "ful_0",
            details: { reference_id: "item_1", quantity: 2 },
          },
          {
            action: "FULFILL_ITEM",
            reference_id: "ful_1",
            details: { reference_id: "item_1", quantity: 1 },
          },
        ],
      },
    ];
    expect(shipmentLines([set], fulfillment, changes, [])).toEqual([
      { itemId: "item_1", quantity: "1", allowance: "0.00" },
    ]);
  });

  it("refuses an item that names no order line instead of leaving it off the invoice (T-201)", () => {
    const fulfillment = {
      id: "ful_1",
      items: [
        { line_item_id: "item_1", quantity: 1 },
        { line_item_id: null, quantity: 1 },
      ],
    };
    expect(() => linesOf([LINE], fulfillment, [])).toThrow(ShipmentItemWithoutLineError);
  });

  it("refuses a shipped line the order did not record units for (T-202)", () => {
    const fulfillment = { id: "ful_1", items: [{ line_item_id: "item_1", quantity: 1 }] };
    expect(() => shipmentLines([LINE], fulfillment, [], [])).toThrow(ShipmentQuantityUnknownError);
  });

  it("refuses a line the order does not have, or whose every unit came back", () => {
    expect(() =>
      linesOf([LINE], { id: "ful_1", items: [{ line_item_id: "item_9", quantity: 1 }] }, []),
    ).toThrow(ShipmentLineUnknownError);
    const allBack = {
      ...LINE,
      detail: { quantity: 3, return_received_quantity: 3 },
      discount_subtotal: 0,
    };
    expect(
      linesOf([allBack], { id: "ful_1", items: [{ line_item_id: "item_1", quantity: 1 }] }, []),
    ).toEqual([{ itemId: "item_1", quantity: "1", allowance: "0.00" }]);
  });
});
