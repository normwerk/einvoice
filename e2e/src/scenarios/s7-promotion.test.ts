import { beforeAll, describe, expect, it } from "vitest";
import { adminLogin, type AdminSession } from "../api/admin.js";
import { createPercentagePromotion } from "../api/catalog-admin.js";
import { checkoutToOrder } from "../api/checkout.js";
import { fulfillOrder, getOrder, waitForDocumentXml } from "../api/orders.js";
import { loadCatalog, requireVariantId, type Catalog } from "../seed/catalog.js";
import * as bt from "../assert/bt.js";
import { validateBytes } from "../assert/conformance.js";

// S7 (P-59): a promotion code reaches the invoice as a line allowance (BG-27) named after the code, and
// the invoice still totals what Medusa charged. Until this scenario, Medusa's computed per-item
// `discount_subtotal` and `adjustments` had only ever been read from synthetic orders.
describe("S7: promotion code -> line allowance", () => {
  let admin: AdminSession;
  let catalog: Catalog;

  beforeAll(async () => {
    admin = await adminLogin();
    catalog = await loadCatalog(admin);
  }, 60_000);

  it("carries a 10% promotion as a line allowance and totals what Medusa charged", async () => {
    await createPercentagePromotion(admin, "S7-TEN", 10);

    const { orderId } = await checkoutToOrder({
      publishableKey: catalog.publishableKey,
      regionId: catalog.regionId,
      salesChannelId: catalog.salesChannelId,
      variantId: requireVariantId(catalog, "SHIRT-S-BLACK"),
      quantity: 2,
      promoCodes: ["S7-TEN"],
      shippingOptionId: catalog.shippingOptionId,
      email: "s7-buyer@einvoice-e2e.example",
      address: {
        firstName: "Max",
        lastName: "Mustermann",
        addressLine1: "Teststr. 7",
        city: "Berlin",
        postalCode: "10115",
        countryCode: "de",
        company: "Musterfirma GmbH",
      },
    });

    await fulfillOrder(admin, orderId, catalog.stockLocationId);
    const { xmlBytes } = await waitForDocumentXml(admin, orderId, "invoice");
    const xml = xmlBytes.toString("utf-8");

    // Two shirts at EUR 10, 10% off the items (not the shipping): one allowance of 2.00 on the line.
    expect(bt.lineAllowances(xml)).toEqual([{ amount: 2, reason: "S7-TEN" }]);
    const order = await getOrder(admin, orderId);
    expect(bt.grandTotalAmount(xml)).toBeCloseTo(order.total, 2);

    const report = await validateBytes(xmlBytes, "s7-invoice.xml");
    expect(report.valid, JSON.stringify(report.messages)).toBe(true);
    expect(report.accepted, JSON.stringify(report.messages)).toBe(true);
  });
});
