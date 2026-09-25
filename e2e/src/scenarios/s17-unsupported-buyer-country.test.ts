import { beforeAll, describe, expect, it } from "vitest";
import { adminLogin, type AdminSession } from "../api/admin.js";
import { checkoutToOrder } from "../api/checkout.js";
import {
  fulfillOrder,
  getEinvoiceStatus,
  getEinvoiceSupport,
  getOrderFulfillmentId,
  type EinvoiceRefusalSummary,
} from "../api/orders.js";
import { loadCatalog, requireVariantId, type Catalog } from "../seed/catalog.js";
import { waitFor } from "../harness/wait-for.js";

// S17 (T-077): a buyer in Italy, which runs a clearance platform of its own (SDI) — no EN 16931 document
// can be submitted there, and this release does not serve it. The order still ships: the invoice is a side
// effect, never a gate. What the merchant sees is a refusal with a stable code, a link to its explanation
// and a support request to open — not a stack trace.
describe("S17: a buyer country the release does not support -> refused with its code, the order ships", () => {
  let admin: AdminSession;
  let catalog: Catalog;

  beforeAll(async () => {
    admin = await adminLogin();
    catalog = await loadCatalog(admin);
  }, 60_000);

  it("records UNSUPPORTED_BUYER_COUNTRY_CLEARANCE with its explanation and a support request", async () => {
    const { orderId } = await checkoutToOrder({
      publishableKey: catalog.publishableKey,
      regionId: catalog.regionId,
      salesChannelId: catalog.salesChannelId,
      variantId: requireVariantId(catalog, "SHIRT-S-BLACK"),
      shippingOptionId: catalog.shippingOptionId,
      email: "s17-buyer@einvoice-e2e.example",
      address: {
        firstName: "Mario",
        lastName: "Rossi",
        addressLine1: "Via Roma 1",
        city: "Milano",
        postalCode: "20121",
        countryCode: "it",
      },
    });
    await fulfillOrder(admin, orderId, catalog.stockLocationId);
    // The fulfillment exists: the refusal did not stop the order.
    expect(await getOrderFulfillmentId(admin, orderId)).toMatch(/^ful_/);

    let refusal: EinvoiceRefusalSummary | undefined;
    await waitFor(
      `refusal for order ${orderId}`,
      async () => {
        refusal = (await getEinvoiceStatus(admin, orderId)).refusals[0];
        return refusal !== undefined;
      },
      { timeoutMs: 30_000 },
    );
    if (refusal === undefined) {
      throw new Error("unreachable: waitFor guarantees a refusal");
    }
    expect(refusal.code).toBe("UNSUPPORTED_BUYER_COUNTRY_CLEARANCE");
    expect(refusal.message).toMatch(/^Not issued: .*"IT"/);
    expect(refusal.docsUrl).toBe(
      "https://normwerk.dev/einvoice/docs/errors#unsupported-buyer-country-clearance",
    );
    expect(refusal.supportRequestUrl).toContain("title=Support%20for%20buyer%20country%20IT");
    expect(refusal.message).not.toMatch(/\bat \w+ \(|\b[TPMD]-\d{2,3}\b/);
    expect((await getEinvoiceStatus(admin, orderId)).documents).toEqual([]);
  });

  it("states what the release supports on the store page", async () => {
    const status = await getEinvoiceSupport(admin);
    expect(status.sellerCountry).toBe("DE");
    expect(status.support).toContain("not supported: IT, PL");
  });
});
