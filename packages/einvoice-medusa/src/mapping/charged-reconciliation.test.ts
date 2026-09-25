import { describe, expect, it } from "vitest";
import {
  chargedForShipment,
  describeChargedReconciliation,
  orderPriceBasis,
  reconcileWithCharged,
  type InvoiceBlock,
  type InvoiceForReconciliation,
  type InvoiceNotice,
} from "./charged-reconciliation.js";
import type { MedusaOrderForInvoice } from "./order-to-commerce-invoice-input.js";

/** One line and one shipping method: a tolerance of three cents. */
function order(overrides: Partial<MedusaOrderForInvoice> = {}): MedusaOrderForInvoice {
  return {
    id: "order_01",
    display_id: 1,
    currency_code: "eur",
    items: [{ title: "Widget", unit_price: 100, is_tax_inclusive: false }],
    shipping_methods: [{ name: "Standard", is_tax_inclusive: false }],
    ...overrides,
  };
}

function invoice(
  totalAmountWithVat: string,
  totalVatAmount: string,
  documentLevelCharges: readonly { amount: string; vatRate: string }[] = [],
): InvoiceForReconciliation {
  return { totals: { totalAmountWithVat, totalVatAmount }, documentLevelCharges };
}

function notice(result: ReturnType<typeof reconcileWithCharged>): InvoiceNotice {
  if (result.outcome !== "notice") throw new Error(`expected a notice, got ${result.outcome}`);
  return result.notice;
}

function block(result: ReturnType<typeof reconcileWithCharged>): InvoiceBlock {
  if (result.outcome !== "block") throw new Error(`expected a block, got ${result.outcome}`);
  return result.block;
}

describe("reconcileWithCharged (P-63)", () => {
  it("issues when VAT and total agree within a cent per rounded amount", () => {
    const result = reconcileWithCharged(
      order({ total: 119.02, tax_total: 19.01 }),
      invoice("119.00", "19.00"),
    );
    expect(result).toEqual({ outcome: "match" });
  });

  it("net prices: the invoice states less VAT and the buyer paid exactly that VAT on top — issued, refund due", () => {
    // Intra-EU supply (K): Medusa charged the region's 19% on 110, the invoice is 110 at 0%.
    const result = notice(
      reconcileWithCharged(order({ total: 130.9, tax_total: 20.9 }), invoice("110.00", "0.00")),
    );
    expect(result).toEqual({
      code: "VAT_OVERCHARGED",
      charged: "130.90",
      chargedVat: "20.90",
      invoiced: "110.00",
      invoicedVat: "0.00",
      priceBasis: "net",
      refundDue: "20.90",
      cause: null,
    });
  });

  it("names shipping split across the order's rates as the cause, when that is the whole VAT difference", () => {
    // 100 at 19% and 100 at 7%, shipping 10: Medusa taxes it at 19% (1.90), the e-invoice splits it
    // 5.00 at 19% (0.95) and 5.00 at 7% (0.35) — 0.60 less VAT, all of it from shipping.
    const mixedCart = order({
      items: [
        { title: "Book", unit_price: 100, is_tax_inclusive: false },
        { title: "Lamp", unit_price: 100, is_tax_inclusive: false },
      ],
      shipping_methods: [{ name: "Standard", is_tax_inclusive: false, tax_total: 1.9 }],
      total: 237.9,
      tax_total: 27.9,
    });
    const result = notice(
      reconcileWithCharged(
        mixedCart,
        invoice("237.30", "27.30", [
          { amount: "5.00", vatRate: "19" },
          { amount: "5.00", vatRate: "7" },
        ]),
      ),
    );
    expect(result).toMatchObject({
      code: "VAT_OVERCHARGED",
      refundDue: "0.60",
      cause: "shipping-split-across-rates",
    });
    expect(describeChargedReconciliation(result)).toContain("splits shipping across");
  });

  it("gross prices: the buyer paid the invoice total and only Medusa's VAT figure differs — issued, nothing to refund", () => {
    const grossOrder = order({
      items: [{ title: "Widget", unit_price: 120, is_tax_inclusive: true }],
      shipping_methods: [],
      total: 120,
      tax_total: 19.16,
    });
    const result = notice(reconcileWithCharged(grossOrder, invoice("120.00", "0.00")));
    expect(result.code).toBe("VAT_DIFFERS_FROM_MEDUSA");
    expect(result.refundDue).toBe("0.00");
    expect(result.priceBasis).toBe("gross");
  });

  // P-70 (M-044): with gross prices the VAT is owed out of what the buyer paid (§10 Abs. 1 UStG), whichever
  // figure Medusa computed — the invoice demands no money that was not taken.
  it("gross prices: Medusa charged less VAT than the invoice states, totals equal — issued with a notice, not blocked", () => {
    const grossOrder = order({
      items: [{ title: "Widget", unit_price: 13.8, is_tax_inclusive: true }],
      shipping_methods: [{ name: "Standard", is_tax_inclusive: true, tax_total: 0 }],
      total: 23.8,
      tax_total: 2.2,
    });
    const result = notice(reconcileWithCharged(grossOrder, invoice("23.80", "3.80")));
    expect(result).toMatchObject({
      code: "VAT_DIFFERS_FROM_MEDUSA",
      charged: "23.80",
      chargedVat: "2.20",
      invoicedVat: "3.80",
      refundDue: "0.00",
      cause: null,
    });
  });

  it("gross prices: names shipping split across rates when Medusa taxed shipping at the lower rate", () => {
    // 107.00 at 7 % and 119.00 at 19 %, shipping 10.00 gross that Medusa taxed at 7 % (0.65); the invoice
    // splits it by the lines' net amounts, 5.00 gross per rate: 0.33 + 0.80 VAT.
    const grossOrder = order({
      items: [
        { title: "Book", unit_price: 107, is_tax_inclusive: true },
        { title: "Lamp", unit_price: 119, is_tax_inclusive: true },
      ],
      shipping_methods: [{ name: "Standard", is_tax_inclusive: true, tax_total: 0.65 }],
      total: 236,
      tax_total: 26.65,
    });
    const result = notice(
      reconcileWithCharged(
        grossOrder,
        invoice("236.00", "27.13", [
          { amount: "4.67", vatRate: "7" },
          { amount: "4.20", vatRate: "19" },
        ]),
      ),
    );
    expect(result).toMatchObject({
      code: "VAT_DIFFERS_FROM_MEDUSA",
      refundDue: "0.00",
      cause: "shipping-split-across-rates",
    });
  });

  it("adds credit lines back: Medusa subtracts store credit, gift cards and refunds from order.total", () => {
    const result = reconcileWithCharged(
      order({ total: 99, tax_total: 19, credit_line_total: 20 }),
      invoice("119.00", "19.00"),
    );
    expect(result).toEqual({ outcome: "match" });
  });

  it("blocks an invoice that would state more VAT than Medusa charged (§14c UStG)", () => {
    // The e2e stand before it had tax rates: Medusa charged 20.00 without VAT, the invoice says 23.80.
    const result = block(
      reconcileWithCharged(order({ total: 20, tax_total: 0 }), invoice("23.80", "3.80")),
    );
    expect(result.code).toBe("INVOICE_VAT_ABOVE_CHARGED");
    expect(result).toMatchObject({ charged: "20.00", chargedVat: "0.00", invoiced: "23.80" });
  });

  it("blocks when VAT agrees but the totals do not — a mapping gap, not a tax difference", () => {
    const result = block(
      reconcileWithCharged(order({ total: 129, tax_total: 19 }), invoice("119.00", "19.00")),
    );
    expect(result.code).toBe("INVOICE_TOTAL_MISMATCH");
  });

  it("blocks when less VAT does not explain the whole difference", () => {
    const result = block(
      reconcileWithCharged(order({ total: 140, tax_total: 20 }), invoice("110.00", "0.00")),
    );
    expect(result.code).toBe("INVOICE_TOTAL_MISMATCH");
  });

  it("blocks a VAT difference on an order that mixes net and gross prices — neither rule applies", () => {
    const mixed = order({
      items: [{ title: "Widget", unit_price: 119, is_tax_inclusive: true }],
      shipping_methods: [{ name: "Standard", is_tax_inclusive: false }],
      total: 119,
      tax_total: 19,
    });
    const result = block(reconcileWithCharged(mixed, invoice("119.00", "0.00")));
    expect(result.code).toBe("INVOICE_TOTAL_MISMATCH");
    expect(describeChargedReconciliation(result)).toContain("mixes prices with and without VAT");
  });

  it("blocks when Medusa returned no totals to compare against", () => {
    const result = block(reconcileWithCharged(order(), invoice("119.00", "19.00")));
    expect(result.code).toBe("CHARGED_TOTALS_MISSING");
    expect(result.charged).toBeNull();
  });
});

describe("orderPriceBasis (P-63)", () => {
  it("reads every line and shipping method", () => {
    expect(orderPriceBasis(order())).toBe("net");
    expect(
      orderPriceBasis(
        order({
          items: [{ title: "Widget", is_tax_inclusive: true }],
          shipping_methods: [{ is_tax_inclusive: true }],
        }),
      ),
    ).toBe("gross");
    expect(orderPriceBasis(order({ items: [{ title: "Widget", is_tax_inclusive: true }] }))).toBe(
      "mixed",
    );
  });
});

describe("describeChargedReconciliation (P-63)", () => {
  it("tells the merchant what to refund, with the amounts and without internal references", () => {
    const text = describeChargedReconciliation({
      code: "VAT_OVERCHARGED",
      charged: "130.90",
      chargedVat: "20.90",
      invoiced: "110.00",
      invoicedVat: "0.00",
      priceBasis: "net",
      refundDue: "20.90",
      cause: null,
    });
    expect(text).toContain("overpaid 20.90");
    expect(text).not.toMatch(/\b[TPMD]-\d{2,3}\b/);
  });

  it("says which way Medusa's VAT differs: less than the e-invoice's is owed anyway, out of what was paid", () => {
    const text = describeChargedReconciliation({
      code: "VAT_DIFFERS_FROM_MEDUSA",
      charged: "23.80",
      chargedVat: "2.20",
      invoiced: "23.80",
      invoicedVat: "3.80",
      priceBasis: "gross",
      refundDue: "0.00",
      cause: null,
    });
    expect(text).toContain(
      "Medusa counts only 2.20 of it as VAT, less than the 3.80 the e-invoice states",
    );
    expect(text).toContain("shipping option");
    expect(text).not.toMatch(/\b[TPMD]-\d{2,3}\b/);
  });
});

describe("chargedForShipment (P-69)", () => {
  // Two shirts at 20.00 net, 19 %: Medusa charged 47.60 for the line, 7.60 of it VAT; shipping 5.95.
  const order = (detail: Record<string, number>, total: number, taxTotal: number) =>
    ({
      id: "order_01",
      display_id: 1,
      currency_code: "eur",
      items: [
        {
          id: "item_shirt",
          title: "Shirt",
          unit_price: 20,
          is_tax_inclusive: false,
          detail: { quantity: 2, ...detail },
          total,
          tax_total: taxTotal,
        },
      ],
      shipping_methods: [
        { name: "Standard", is_tax_inclusive: false, total: 5.95, tax_total: 0.95 },
      ],
      total: 53.55,
      tax_total: 8.55,
    }) as MedusaOrderForInvoice;
  const oneShirt = [{ itemId: "item_shirt", quantity: "1", allowance: "0.00" }];

  it("takes the fulfillment's units at Medusa's per-unit amounts, and the shipping it carries", () => {
    const charged = chargedForShipment(order({}, 47.6, 7.6), {
      lines: oneShirt,
      includesShipping: true,
      deliveryDate: "2026-09-12",
    });
    expect(charged).toMatchObject({ total: 2975, vat: 475, priceBasis: "net", tolerance: 3 });
    const withoutShipping = chargedForShipment(order({}, 47.6, 7.6), {
      lines: oneShirt,
      includesShipping: false,
      deliveryDate: "2026-09-13",
    });
    expect(withoutShipping).toMatchObject({ total: 2380, vat: 380, tolerance: 2 });
    expect(
      reconcileWithCharged(order({}, 47.6, 7.6), invoice("23.80", "3.80"), withoutShipping),
    ).toEqual({ outcome: "match" });
  });

  it("values a unit the same after the other unit came back — Medusa then states the line for one", () => {
    const charged = chargedForShipment(order({ return_received_quantity: 1 }, 23.8, 3.8), {
      lines: oneShirt,
      includesShipping: false,
      deliveryDate: "2026-09-13",
    });
    expect(charged).toMatchObject({ total: 2380, vat: 380 });
  });

  it("says nothing when every unit came back or Medusa gave no totals — the check then blocks", () => {
    const scope = { lines: oneShirt, includesShipping: false, deliveryDate: "2026-09-13" };
    const allBack = chargedForShipment(order({ return_received_quantity: 2 }, 0, 0), scope);
    expect(allBack.total).toBeNull();
    expect(
      block(reconcileWithCharged(order({}, 47.6, 7.6), invoice("23.80", "3.80"), allBack)).code,
    ).toBe("CHARGED_TOTALS_MISSING");
  });
});
