import { beforeAll, describe, expect, it } from "vitest";
import { adminLogin, type AdminSession } from "../api/admin.js";
import { registerCustomer } from "../api/customer.js";
import { checkoutToOrder } from "../api/checkout.js";
import { downloadEinvoiceFile, fulfillOrder, listEinvoiceDocuments } from "../api/orders.js";
import { storeFetch } from "../api/store.js";
import { loadCatalog, requireVariantId, type Catalog } from "../seed/catalog.js";
import { waitFor } from "../harness/wait-for.js";

// plan-e2e.md §4: the Store API's own ownership check (`customerOwnsOrder`,
// packages/einvoice-medusa/src/api/einvoice-http.ts) — owner gets the file, a different registered
// customer gets 404 (not 403, so as not to confirm the order even exists), no token gets 401.
describe("Store API: order ownership", () => {
  let admin: AdminSession;
  let catalog: Catalog;

  beforeAll(async () => {
    admin = await adminLogin();
    catalog = await loadCatalog(admin);
  }, 60_000);

  it("owner gets 200, a different customer gets 404, no token gets 401", async () => {
    const owner = await registerCustomer(catalog.publishableKey, {
      email: "ownership-owner@einvoice-e2e.example",
      password: "ownership-owner-password",
      companyName: "Musterfirma GmbH",
    });
    const other = await registerCustomer(catalog.publishableKey, {
      email: "ownership-other@einvoice-e2e.example",
      password: "ownership-other-password",
      companyName: "Other GmbH",
    });

    const { orderId } = await checkoutToOrder({
      publishableKey: catalog.publishableKey,
      regionId: catalog.regionId,
      salesChannelId: catalog.salesChannelId,
      variantId: requireVariantId(catalog, "SHORTS-XL"),
      shippingOptionId: catalog.shippingOptionId,
      email: "ownership-owner@einvoice-e2e.example",
      customerToken: owner.token,
      address: {
        firstName: "Owner",
        lastName: "Buyer",
        addressLine1: "Teststr. 5",
        city: "Berlin",
        postalCode: "10115",
        countryCode: "de",
        company: "Musterfirma GmbH",
      },
    });

    await fulfillOrder(admin, orderId, catalog.stockLocationId);
    let documents = await listEinvoiceDocuments(admin, orderId);
    await waitFor(
      `invoice for order ${orderId}`,
      async () => {
        documents = await listEinvoiceDocuments(admin, orderId);
        return documents.length > 0;
      },
      { timeoutMs: 30_000 },
    );
    const document = documents[0];
    if (document === undefined) {
      throw new Error("unreachable: waitFor guarantees documents.length > 0");
    }

    const ownerResponse = await storeFetch(
      catalog.publishableKey,
      `/store/orders/${orderId}/einvoice/${document.id}/xml`,
      {},
      owner.token,
    );
    expect(ownerResponse.status).toBe(200);
    const ownerBytes = Buffer.from(await ownerResponse.arrayBuffer());

    const adminBytes = await downloadEinvoiceFile(admin, orderId, document.id, "xml");
    expect(ownerBytes.equals(adminBytes)).toBe(true);

    const otherResponse = await storeFetch(
      catalog.publishableKey,
      `/store/orders/${orderId}/einvoice/${document.id}/xml`,
      {},
      other.token,
    );
    expect(otherResponse.status).toBe(404);

    const noTokenResponse = await storeFetch(
      catalog.publishableKey,
      `/store/orders/${orderId}/einvoice/${document.id}/xml`,
    );
    expect(noTokenResponse.status).toBe(401);
  });
});
