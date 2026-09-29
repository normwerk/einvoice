import { describe, expect, it } from "vitest";
import {
  assertNoReplacementShipped,
  assertRefundNotOnReplacement,
  RefundOnReplacementError,
  ReplacementShipmentError,
  replacementLines,
} from "./replacement.js";

const EXCHANGE = { id: "exchange_1", canceled_at: null, additional_items: [{ item_id: "item_l" }] };
const CLAIM_REPLACE = {
  id: "claim_1",
  canceled_at: null,
  additional_items: [
    { item_id: "item_broken", is_additional_item: false },
    { item_id: "item_new", is_additional_item: true },
  ],
};
const CLAIM_REFUND = {
  id: "claim_2",
  canceled_at: null,
  additional_items: [{ item_id: "item_broken", is_additional_item: false }],
};
const codeOf = (run: () => void): string | undefined => {
  try {
    run();
    return undefined;
  } catch (error) {
    return (error as { code?: string }).code;
  }
};
const shipping = (...lineItemIds: (string | null)[]) => ({
  id: "ful_2",
  items: lineItemIds.map((line_item_id) => ({ line_item_id })),
});

describe("exchanges and warranty replacements are refused, not documented (T-201)", () => {
  it("knows an exchange's new item and a claim's replacement — not the item the buyer claims for", () => {
    expect([...replacementLines([EXCHANGE], [CLAIM_REPLACE]).entries()]).toEqual([
      ["item_l", "exchange"],
      ["item_new", "claim"],
    ]);
  });

  it("ignores a cancelled exchange or claim", () => {
    const cancelled = { canceled_at: "2026-09-28T10:00:00Z" };
    expect(
      replacementLines([{ ...EXCHANGE, ...cancelled }], [{ ...CLAIM_REPLACE, ...cancelled }]).size,
    ).toBe(0);
  });

  it("refuses a shipment of an exchange's new item, or of a replacement — and a shipment mixing one in", () => {
    const lines = replacementLines([EXCHANGE], [CLAIM_REPLACE]);
    expect(codeOf(() => assertNoReplacementShipped(shipping("item_l"), lines))).toBe(
      "SHIPMENT_OF_EXCHANGE",
    );
    expect(
      codeOf(() => assertNoReplacementShipped(shipping("item_shirt", "item_new"), lines)),
    ).toBe("SHIPMENT_OF_CLAIM_REPLACEMENT");
    expect(() => assertNoReplacementShipped(shipping("item_l"), lines)).toThrow(
      ReplacementShipmentError,
    );
    expect(() => assertNoReplacementShipped(shipping("item_shirt"), lines)).not.toThrow();
  });

  it("refuses a refund on an order with an exchange or a claim with a replacement, not on a claim for money back", () => {
    expect(codeOf(() => assertRefundNotOnReplacement("order_1", [EXCHANGE], []))).toBe(
      "REFUND_ON_EXCHANGE",
    );
    expect(codeOf(() => assertRefundNotOnReplacement("order_1", [], [CLAIM_REPLACE]))).toBe(
      "REFUND_ON_CLAIM_REPLACEMENT",
    );
    expect(() => assertRefundNotOnReplacement("order_1", [], [CLAIM_REPLACE])).toThrow(
      RefundOnReplacementError,
    );
    expect(() => assertRefundNotOnReplacement("order_1", [], [CLAIM_REFUND])).not.toThrow();
    const cancelled = { ...EXCHANGE, canceled_at: "2026-09-28T10:00:00Z" };
    expect(() => assertRefundNotOnReplacement("order_1", [cancelled], [])).not.toThrow();
  });
});
