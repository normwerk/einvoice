import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminLogin, type AdminSession } from "../api/admin.js";
import { setRegionPricesIncludeTax } from "../api/catalog-admin.js";
import { checkoutToOrder } from "../api/checkout.js";
import { fulfillOrder, getEinvoiceStatus, getOrder, waitForDocumentXml } from "../api/orders.js";
import { createShippingOptionTaxRate, deleteTaxRate } from "../api/tax.js";
import { loadCatalog, requireVariantId, type Catalog } from "../seed/catalog.js";
import * as bt from "../assert/bt.js";
import { validateBytes } from "../assert/conformance.js";

// S16 (P-70, M-044): a shop with prices including VAT whose shipping option carries no VAT in Medusa (a 0%
// override). The buyer pays 20.00 — a T-shirt and shipping at 10.00 each — and Medusa counts VAT on the
// T-shirt alone; the invoice takes 19% out of both, shipping following the goods. The totals agree, so the
// invoice demands nothing that was not paid: it is issued, with a notice that Medusa's VAT is lower. With net
// prices the same shop is blocked (S13).
describe("S16: prices including VAT, Medusa's VAT below the invoice's -> issued with a notice", () => {
  let admin: AdminSession;
  let catalog: Catalog;
  let taxRateId: string | undefined;

  beforeAll(async () => {
    admin = await adminLogin();
    catalog = await loadCatalog(admin);
    await setRegionPricesIncludeTax(admin, catalog.regionId, true);
    taxRateId = await createShippingOptionTaxRate(admin, "de", catalog.shippingOptionId, 0);
  }, 60_000);

  afterAll(async () => {
    // Both would change every later scenario; undone even when this one fails.
    if (taxRateId !== undefined) {
      await deleteTaxRate(admin, taxRateId);
    }
    await setRegionPricesIncludeTax(admin, catalog.regionId, false);
  }, 60_000);

  it("issues the invoice at 19% out of what was paid, and says Medusa counts less VAT", async () => {
    const { orderId } = await checkoutToOrder({
      publishableKey: catalog.publishableKey,
      regionId: catalog.regionId,
      salesChannelId: catalog.salesChannelId,
      variantId: requireVariantId(catalog, "SHIRT-S-BLACK"),
      shippingOptionId: catalog.shippingOptionId,
      email: "s16-buyer@einvoice-e2e.example",
      address: {
        firstName: "Erika",
        lastName: "Musterfrau",
        addressLine1: "Teststr. 16",
        city: "Hamburg",
        postalCode: "20095",
        countryCode: "de",
      },
    });
    const order = await getOrder(admin, orderId);
    expect(order.total).toBeCloseTo(20, 2);
    // 19% out of the T-shirt's 10.00 only.
    expect(order.taxTotal).toBeCloseTo(1.6, 2);

    await fulfillOrder(admin, orderId, catalog.stockLocationId);
    const { document: invoice, xmlBytes } = await waitForDocumentXml(admin, orderId, "invoice");
    const xml = xmlBytes.toString("utf-8");
    expect(bt.grandTotalAmount(xml)).toBeCloseTo(20, 2);
    // 19% out of 20.00: shipping shares the goods' rate.
    expect(bt.taxTotalAmount(xml)).toBeCloseTo(3.19, 2);
    expect(bt.grossByRate(xml)).toEqual({ "19": 20 });

    const status = await getEinvoiceStatus(admin, orderId);
    expect(status.refusals).toEqual([]);
    const notice = status.documents.find((d) => d.id === invoice.id)?.notice;
    expect(notice?.code).toBe("VAT_DIFFERS_FROM_MEDUSA");
    expect(notice?.details).toMatchObject({
      chargedVat: "1.60",
      invoicedVat: "3.19",
      refundDue: "0.00",
      priceBasis: "gross",
    });
    expect(notice?.message).toContain("Medusa counts only 1.60 of it as VAT");

    const report = await validateBytes(xmlBytes, "s16-invoice.xml");
    expect(report.valid, JSON.stringify(report.messages)).toBe(true);
    expect(report.accepted, JSON.stringify(report.messages)).toBe(true);
  });
});
