import { beforeAll, describe, expect, it } from "vitest";
import { adminLogin, type AdminSession } from "../api/admin.js";
import { registerCustomer, setCustomerVatId } from "../api/customer.js";
import { checkoutToOrder } from "../api/checkout.js";
import {
  downloadEinvoiceFile,
  fulfillOrder,
  getOrder,
  listEinvoiceDocuments,
} from "../api/orders.js";
import { loadCatalog, requireVariantId, type Catalog } from "../seed/catalog.js";
import { waitFor } from "../harness/wait-for.js";
import { VALID_VAT_ID } from "../harness/env.js";
import * as bt from "../assert/bt.js";
import { validateBytes } from "../assert/conformance.js";

// S2 (plan-e2e.md §4): DE -> FR B2B with a VAT-ID. Kept even though T-117's fixture matrix already covers
// category K's tax rules (plan-e2e.md §4's own reasoning) — this is a cross-check that a *real* Medusa
// order's shape (customer.company_name, customer.metadata.vat_id, a real FR address) matches what T-117's
// synthetic fixtures assume, not a re-test of the VAT category decision itself.
describe("S2: DE -> FR B2B with VAT-ID", () => {
  let admin: AdminSession;
  let catalog: Catalog;

  beforeAll(async () => {
    admin = await adminLogin();
    catalog = await loadCatalog(admin);
  }, 60_000);

  it("produces a KoSIT-green category-K invoice with the buyer's VAT-ID", async () => {
    const customer = await registerCustomer(catalog.publishableKey, {
      email: "s2-buyer@einvoice-e2e.example",
      password: "s2-buyer-password",
      companyName: "Dupont SARL",
    });
    await setCustomerVatId(admin, customer.customerId, VALID_VAT_ID);

    const { orderId } = await checkoutToOrder({
      publishableKey: catalog.publishableKey,
      regionId: catalog.regionId,
      salesChannelId: catalog.salesChannelId,
      variantId: requireVariantId(catalog, "SWEATSHIRT-M"),
      shippingOptionId: catalog.shippingOptionId,
      email: "s2-buyer@einvoice-e2e.example",
      customerToken: customer.token,
      address: {
        firstName: "Jean",
        lastName: "Dupont",
        addressLine1: "1 Rue de Paris",
        city: "Paris",
        postalCode: "75001",
        countryCode: "fr",
        company: "Dupont SARL",
      },
    });

    await fulfillOrder(admin, orderId, catalog.stockLocationId);

    let documents = await listEinvoiceDocuments(admin, orderId);
    await waitFor(
      `einvoice document for order ${orderId}`,
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

    const xmlBytes = await downloadEinvoiceFile(admin, orderId, document.id, "xml");
    const xml = xmlBytes.toString("utf-8");

    expect(bt.vatCategoryCode(xml)).toBe("K");
    expect(bt.buyerVatId(xml)).toBe(VALID_VAT_ID);
    // France has no rate on this stand, so Medusa charges no VAT — as category K requires (P-59).
    const order = await getOrder(admin, orderId);
    expect(bt.grandTotalAmount(xml)).toBeCloseTo(order.total, 2);

    const report = await validateBytes(xmlBytes, "s2-invoice.xml");
    expect(report.valid, JSON.stringify(report.messages)).toBe(true);
    expect(report.accepted, JSON.stringify(report.messages)).toBe(true);
  });
});
