import { describe, expect, it } from "vitest";
import { shipmentLines, ShipmentLineUnknownError } from "./shipment.js";
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

describe("shipmentLines (P-67)", () => {
  it("invoices what the fulfillment shipped, with its share of the line discount", () => {
    expect(
      shipmentLines([LINE], { id: "ful_1", items: [{ line_item_id: "item_1", quantity: 1 }] }, []),
    ).toEqual([{ itemId: "item_1", quantity: "1", allowance: "0.33" }]);
  });

  it("gives the shipment that completes a line what is left of its discount, to the cent", () => {
    const first = shipmentLines(
      [LINE],
      { id: "ful_1", items: [{ line_item_id: "item_1", quantity: 1 }] },
      [],
    );
    const second = shipmentLines(
      [LINE],
      { id: "ful_2", items: [{ line_item_id: "item_1", quantity: 1 }] },
      first,
    );
    const third = shipmentLines(
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
      shipmentLines(
        [gross],
        { id: "ful_1", items: [{ line_item_id: "item_1", quantity: 3 }] },
        [],
      )[0]?.allowance,
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
      shipmentLines(
        [afterReturn],
        { id: "ful_1", items: [{ line_item_id: "item_1", quantity: 1 }] },
        [],
      )[0]?.allowance,
    ).toBe("0.34");
  });

  it("adds up the units of a line the fulfillment lists twice, and skips empty entries", () => {
    expect(
      shipmentLines(
        [LINE],
        {
          id: "ful_1",
          items: [
            { line_item_id: "item_1", quantity: 1 },
            { line_item_id: "item_1", quantity: 2 },
            { line_item_id: null, quantity: 1 },
          ],
        },
        [],
      ),
    ).toEqual([{ itemId: "item_1", quantity: "3", allowance: "1.00" }]);
  });

  it("refuses a line the order does not have, or whose every unit came back", () => {
    expect(() =>
      shipmentLines([LINE], { id: "ful_1", items: [{ line_item_id: "item_9", quantity: 1 }] }, []),
    ).toThrow(ShipmentLineUnknownError);
    const allBack = {
      ...LINE,
      detail: { quantity: 3, return_received_quantity: 3 },
      discount_subtotal: 0,
    };
    expect(
      shipmentLines(
        [allBack],
        { id: "ful_1", items: [{ line_item_id: "item_1", quantity: 1 }] },
        [],
      ),
    ).toEqual([{ itemId: "item_1", quantity: "1", allowance: "0.00" }]);
  });
});
