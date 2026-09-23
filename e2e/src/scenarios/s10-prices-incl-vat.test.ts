import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminLogin, type AdminSession } from "../api/admin.js";
import { createPercentagePromotion, setRegionPricesIncludeTax } from "../api/catalog-admin.js";
import { checkoutToOrder } from "../api/checkout.js";
import { fulfillOrder, getOrder, waitForDocumentXml } from "../api/orders.js";
import { loadCatalog, requireVariantId, type Catalog } from "../seed/catalog.js";
import * as bt from "../assert/bt.js";
import { validateBytes } from "../assert/conformance.js";

// S10 (P-61): a shop whose prices include VAT — the norm for German B2C. Measured before P-61: a T-shirt at
// 10.00 and shipping at 10.00, both gross, were charged 20.00 and invoiced 19.99, because each line's net was
// rounded on its own. The invoice now keeps the gross amounts: each rate group's VAT is taken out of its
// gross total. This scenario switches the stand's region to tax-inclusive prices and back.
describe("S10: prices including VAT -> the invoice totals what was charged", () => {
  let admin: AdminSession;
  let catalog: Catalog;

  beforeAll(async () => {
    admin = await adminLogin();
    catalog = await loadCatalog(admin);
    await setRegionPricesIncludeTax(admin, catalog.regionId, true);
  }, 60_000);

  afterAll(async () => {
    await setRegionPricesIncludeTax(admin, catalog.regionId, false);
  }, 60_000);

  async function invoiceFor(email: string, quantity: number, promoCodes?: readonly string[]) {
    const { orderId } = await checkoutToOrder({
      publishableKey: catalog.publishableKey,
      regionId: catalog.regionId,
      salesChannelId: catalog.salesChannelId,
      variantId: requireVariantId(catalog, "SHIRT-S-BLACK"),
      quantity,
      ...(promoCodes === undefined ? {} : { promoCodes }),
      shippingOptionId: catalog.shippingOptionId,
      email,
      address: {
        firstName: "Erika",
        lastName: "Musterfrau",
        addressLine1: "Teststr. 10",
        city: "Berlin",
        postalCode: "10115",
        countryCode: "de",
      },
    });
    await fulfillOrder(admin, orderId, catalog.stockLocationId);
    const { xmlBytes } = await waitForDocumentXml(admin, orderId, "invoice");
    return { xml: xmlBytes.toString("utf-8"), xmlBytes, order: await getOrder(admin, orderId) };
  }

  it("invoices a T-shirt and shipping at 10.00 each as 20.00, not 19.99", async () => {
    const { xml, xmlBytes, order } = await invoiceFor("s10-buyer@einvoice-e2e.example", 1);
    expect(order.total).toBeCloseTo(20, 2);
    expect(bt.grandTotalAmount(xml)).toBeCloseTo(20, 2);
    const report = await validateBytes(xmlBytes, "s10-invoice.xml");
    expect(report.valid, JSON.stringify(report.messages)).toBe(true);
    expect(report.accepted, JSON.stringify(report.messages)).toBe(true);
  });

  it("keeps the gross total with a promotion on tax-inclusive prices", async () => {
    await createPercentagePromotion(admin, "S10-TEN", 10);
    const { xml, xmlBytes, order } = await invoiceFor("s10-promo@einvoice-e2e.example", 3, [
      "S10-TEN",
    ]);
    // 3 × 10.00 − 10% + 10.00 shipping, all including VAT.
    expect(order.total).toBeCloseTo(37, 2);
    expect(bt.grandTotalAmount(xml)).toBeCloseTo(order.total, 2);
    expect(bt.lineAllowances(xml).map((allowance) => allowance.reason)).toEqual(["S10-TEN"]);
    const report = await validateBytes(xmlBytes, "s10-promo-invoice.xml");
    expect(report.valid, JSON.stringify(report.messages)).toBe(true);
    expect(report.accepted, JSON.stringify(report.messages)).toBe(true);
  });
});
