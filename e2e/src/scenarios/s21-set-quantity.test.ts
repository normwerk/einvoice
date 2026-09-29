import { beforeAll, describe, expect, it } from "vitest";
import { adminLogin, type AdminSession } from "../api/admin.js";
import { createSetProduct } from "../api/catalog-admin.js";
import { checkoutToOrder } from "../api/checkout.js";
import { fulfillOrder, getOrder, waitForDocumentXml } from "../api/orders.js";
import { loadCatalog, type Catalog } from "../seed/catalog.js";
import * as bt from "../assert/bt.js";
import { validateBytes } from "../assert/conformance.js";

// S21 (T-202): a set — one variant drawing on two inventory items, a table and four chairs. Medusa ships it as
// one fulfillment item per inventory item (1 table, 4 chairs); the order records one unit of the line. The
// invoice states one set at the set's price and totals what Medusa charged — not five sets.
describe("S21: a set of two inventory items -> invoiced as one set", () => {
  let admin: AdminSession;
  let catalog: Catalog;
  let setVariantId: string;

  beforeAll(async () => {
    admin = await adminLogin();
    catalog = await loadCatalog(admin);
    setVariantId = await createSetProduct(admin, {
      title: "Essgruppe",
      sku: `SET-DINING-${Date.now()}`,
      priceEur: 400,
      salesChannelId: catalog.salesChannelId,
      stockLocationId: catalog.stockLocationId,
      shippingOptionId: catalog.shippingOptionId,
    });
  }, 60_000);

  it("states one set, at the order's total", async () => {
    const { orderId } = await checkoutToOrder({
      publishableKey: catalog.publishableKey,
      regionId: catalog.regionId,
      salesChannelId: catalog.salesChannelId,
      variantId: setVariantId,
      shippingOptionId: catalog.shippingOptionId,
      email: "s21-buyer@einvoice-e2e.example",
      address: {
        firstName: "Sina",
        lastName: "Satz",
        addressLine1: "Teststr. 21",
        city: "Leipzig",
        postalCode: "04109",
        countryCode: "de",
        company: "Satz Möbel GmbH",
      },
    });
    await fulfillOrder(admin, orderId, catalog.stockLocationId);

    const { xmlBytes } = await waitForDocumentXml(admin, orderId, "invoice");
    const xml = xmlBytes.toString("utf-8");
    expect(bt.lineNames(xml)).toHaveLength(1);
    expect(bt.lineNames(xml)[0]).toContain("Essgruppe");
    expect(bt.lineQuantities(xml)).toEqual([1]);
    const order = await getOrder(admin, orderId);
    expect(bt.grandTotalAmount(xml)).toBeCloseTo(order.total, 2);
    expect(bt.taxTotalAmount(xml)).toBeCloseTo(order.taxTotal, 2);
    const report = await validateBytes(xmlBytes, "s21-invoice.xml");
    expect(report.valid, JSON.stringify(report.messages)).toBe(true);
    expect(report.accepted, JSON.stringify(report.messages)).toBe(true);
  });
});
