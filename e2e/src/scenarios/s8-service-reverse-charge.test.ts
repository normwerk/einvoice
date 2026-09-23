import { beforeAll, describe, expect, it } from "vitest";
import { adminLogin, type AdminSession } from "../api/admin.js";
import { createServiceProduct } from "../api/catalog-admin.js";
import { registerCustomer, setCustomerVatId } from "../api/customer.js";
import { checkoutToOrder } from "../api/checkout.js";
import { fulfillOrder, getOrder, setOrderMetadata, waitForDocumentXml } from "../api/orders.js";
import { loadCatalog, type Catalog } from "../seed/catalog.js";
import { VALID_VAT_ID } from "../harness/env.js";
import * as bt from "../assert/bt.js";
import { validateBytes } from "../assert/conformance.js";

// S8 (P-36, P-59): an order holding only a service. The invoice is issued on `order.fulfillment_created`,
// and a service ships nothing — so the open question was whether such an order is ever invoiced. Verified
// against a real Medusa: the cart completes without a shipping method, and the merchant can still create a
// fulfillment for it (no shipping option needed), which issues the invoice. The buyer is a French business
// with a VAT-ID and the merchant declares the cross-border reverse charge on the order
// (`docs/tax-semantics.md` row 12), so this is also the one run of category AE through a real Medusa.
describe("S8: service to an EU business -> reverse-charge invoice", () => {
  let admin: AdminSession;
  let catalog: Catalog;

  beforeAll(async () => {
    admin = await adminLogin();
    catalog = await loadCatalog(admin);
  }, 60_000);

  it("invoices a services-only order once it is fulfilled, in category AE", async () => {
    const variantId = await createServiceProduct(admin, {
      title: "Beratungsstunde",
      sku: "S8-CONSULTING-HOUR",
      priceEur: 100,
      salesChannelId: catalog.salesChannelId,
    });
    const customer = await registerCustomer(catalog.publishableKey, {
      email: "s8-buyer@einvoice-e2e.example",
      password: "s8-buyer-password",
      companyName: "Dupont Conseil SARL",
    });
    await setCustomerVatId(admin, customer.customerId, VALID_VAT_ID);

    const { orderId } = await checkoutToOrder({
      publishableKey: catalog.publishableKey,
      regionId: catalog.regionId,
      salesChannelId: catalog.salesChannelId,
      variantId,
      email: "s8-buyer@einvoice-e2e.example",
      customerToken: customer.token,
      address: {
        firstName: "Jean",
        lastName: "Dupont",
        addressLine1: "8 Rue de Lyon",
        city: "Lyon",
        postalCode: "69001",
        countryCode: "fr",
        company: "Dupont Conseil SARL",
      },
    });

    await setOrderMetadata(admin, orderId, {
      regime_override: { kind: "reverse-charge-cross-border" },
    });
    await fulfillOrder(admin, orderId, catalog.stockLocationId);
    const { xmlBytes } = await waitForDocumentXml(admin, orderId, "invoice");
    const xml = xmlBytes.toString("utf-8");

    expect(bt.vatCategoryCode(xml)).toBe("AE");
    expect(bt.buyerVatId(xml)).toBe(VALID_VAT_ID);
    // France has no rate on this stand, so Medusa charged no VAT — as a reverse-charge invoice shows.
    const order = await getOrder(admin, orderId);
    expect(bt.grandTotalAmount(xml)).toBeCloseTo(100, 2);
    expect(bt.grandTotalAmount(xml)).toBeCloseTo(order.total, 2);

    const report = await validateBytes(xmlBytes, "s8-invoice.xml");
    expect(report.valid, JSON.stringify(report.messages)).toBe(true);
    expect(report.accepted, JSON.stringify(report.messages)).toBe(true);
  });
});
