import { describe, expect, it, vi } from "vitest";
import type { MedusaContainer, SubscriberArgs } from "@medusajs/framework";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { EINVOICE_MODULE } from "../modules/einvoice/index.js";
import priceNoticeOnOrderEditConfirmed from "./price-notice-on-order-edit-confirmed.js";

const INVOICE = {
  id: "einvdoc_1",
  document_number: "RE-2026-0001",
  created_at: "2026-09-20T10:00:00Z",
  line_values: [
    { itemId: "item_1", rate: "19", quantity: "1", gross: "23.80", unitPrice: "20.0000" },
  ],
  price_notices: null,
};
const EDIT = {
  id: "ordch_1",
  confirmed_at: "2026-09-21T10:00:00Z",
  actions: [
    { action: "ITEM_UPDATE", details: { reference_id: "item_1", quantity: 1, unit_price: 15 } },
  ],
};

function run(invoices: readonly unknown[], edits: readonly unknown[]) {
  const service = {
    listEinvoiceDocuments: vi.fn(async () => invoices),
    setPriceNotices: vi.fn(async () => undefined),
  };
  const graph = vi.fn(async () => ({ data: edits }));
  const registry = new Map<unknown, unknown>([
    [EINVOICE_MODULE, service],
    [ContainerRegistrationKeys.QUERY, { graph }],
    [ContainerRegistrationKeys.LOGGER, { warn: vi.fn() }],
  ]);
  const container = { resolve: (key: unknown) => registry.get(key) } as unknown as MedusaContainer;
  const args = {
    event: { data: { order_id: "order_1" } },
    container,
  } as unknown as SubscriberArgs<{
    order_id: string;
  }>;
  return { service, graph, done: priceNoticeOnOrderEditConfirmed(args) };
}

describe("priceNoticeOnOrderEditConfirmed (T-201)", () => {
  it("notes a price an edit lowered after the invoice, reading the order's confirmed edits", async () => {
    const { service, graph, done } = run([INVOICE], [EDIT]);
    await done;
    expect(graph).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: "order_change",
        filters: { order_id: "order_1", change_type: "edit", status: "confirmed" },
      }),
    );
    expect(service.setPriceNotices).toHaveBeenCalledWith("einvdoc_1", [
      expect.objectContaining({ itemId: "item_1", newUnitPrice: "15.00", direction: "lowered" }),
    ]);
  });

  it("takes a notice away when the price went back, and leaves an invoice without either alone", async () => {
    const back = { ...EDIT, id: "ordch_2", confirmed_at: "2026-09-22T10:00:00Z" };
    back.actions = [
      { action: "ITEM_UPDATE", details: { reference_id: "item_1", quantity: 1, unit_price: 20 } },
    ];
    const noted = { ...INVOICE, price_notices: [{ itemId: "item_1" }] };
    const first = run([noted], [EDIT, back]);
    await first.done;
    expect(first.service.setPriceNotices).toHaveBeenCalledWith("einvdoc_1", []);

    const second = run([INVOICE], [back]);
    await second.done;
    expect(second.service.setPriceNotices).not.toHaveBeenCalled();
  });

  it("does nothing on an order without an invoice", async () => {
    const { graph, done } = run([], [EDIT]);
    await done;
    expect(graph).not.toHaveBeenCalled();
  });
});
