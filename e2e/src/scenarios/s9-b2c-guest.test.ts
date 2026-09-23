import { beforeAll, describe, expect, it } from "vitest";
import { adminLogin, type AdminSession } from "../api/admin.js";
import { checkoutToOrder } from "../api/checkout.js";
import { fulfillOrder, getOrder, waitForDocumentXml } from "../api/orders.js";
import { loadCatalog, requireVariantId, type Catalog } from "../seed/catalog.js";
import * as bt from "../assert/bt.js";
import { validateBytes } from "../assert/conformance.js";

// S9 (P-59): the most common shop order — a private person, checking out as a guest, no company and no
// VAT-ID. A guest has no name on their Medusa customer record, so before P-59 the invoice named the buyer
// after their email; the billing address names them now.
describe("S9: DE private buyer, guest checkout", () => {
  let admin: AdminSession;
  let catalog: Catalog;

  beforeAll(async () => {
    admin = await adminLogin();
    catalog = await loadCatalog(admin);
  }, 60_000);

  it("names the buyer from the billing address and totals what Medusa charged", async () => {
    const { orderId } = await checkoutToOrder({
      publishableKey: catalog.publishableKey,
      regionId: catalog.regionId,
      salesChannelId: catalog.salesChannelId,
      variantId: requireVariantId(catalog, "SHIRT-S-BLACK"),
      shippingOptionId: catalog.shippingOptionId,
      email: "s9-buyer@einvoice-e2e.example",
      address: {
        firstName: "Erika",
        lastName: "Musterfrau",
        addressLine1: "Teststr. 9",
        city: "Hamburg",
        postalCode: "20095",
        countryCode: "de",
      },
    });

    await fulfillOrder(admin, orderId, catalog.stockLocationId);
    const { xmlBytes } = await waitForDocumentXml(admin, orderId, "invoice");
    const xml = xmlBytes.toString("utf-8");

    expect(bt.buyerName(xml)).toBe("Erika Musterfrau");
    expect(bt.addressLineOne(xml, "BuyerTradeParty")).toBe("Teststr. 9");
    expect(bt.vatCategoryCode(xml)).toBe("S");
    expect(bt.buyerVatId(xml)).toBeUndefined();
    const order = await getOrder(admin, orderId);
    expect(bt.grandTotalAmount(xml)).toBeCloseTo(order.total, 2);

    const report = await validateBytes(xmlBytes, "s9-invoice.xml");
    expect(report.valid, JSON.stringify(report.messages)).toBe(true);
    expect(report.accepted, JSON.stringify(report.messages)).toBe(true);
  });
});
