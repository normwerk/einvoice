import { beforeAll, describe, expect, it } from "vitest";
import { adminLogin, type AdminSession } from "../api/admin.js";
import { registerCustomer, setCustomerVatId } from "../api/customer.js";
import { checkoutToOrder } from "../api/checkout.js";
import {
  downloadEinvoiceFile,
  fulfillOrder,
  getEinvoiceStatus,
  retryRefusal,
  setOrderMetadata,
  type EinvoiceRefusalSummary,
} from "../api/orders.js";
import { loadCatalog, requireVariantId, type Catalog } from "../seed/catalog.js";
import { waitFor } from "../harness/wait-for.js";
import { UNAVAILABLE_VAT_ID } from "../harness/env.js";
import * as bt from "../assert/bt.js";
import { validateBytes } from "../assert/conformance.js";

// S14 (P-66): VIES does not answer for the buyer's VAT-ID when the order ships, so category K cannot be
// decided and the invoice is refused — recorded with its reason, visible through the admin API, instead of
// an error in the log and no invoice. A retry while VIES is still down is refused again; once the merchant
// confirms the number another way (`order.metadata.regime_override`, kind `intra-eu-confirmed`), the retry
// issues the K invoice.
describe("S14: VIES unavailable -> not issued, confirmed by hand, retried", () => {
  let admin: AdminSession;
  let catalog: Catalog;

  beforeAll(async () => {
    admin = await adminLogin();
    catalog = await loadCatalog(admin);
  }, 60_000);

  it("records the refusal and issues the K invoice on retry once the VAT-ID is confirmed", async () => {
    const customer = await registerCustomer(catalog.publishableKey, {
      email: "s14-buyer@einvoice-e2e.example",
      password: "s14-buyer-password",
      companyName: "Exemple SAS",
    });
    await setCustomerVatId(admin, customer.customerId, UNAVAILABLE_VAT_ID);
    const { orderId } = await checkoutToOrder({
      publishableKey: catalog.publishableKey,
      regionId: catalog.regionId,
      salesChannelId: catalog.salesChannelId,
      variantId: requireVariantId(catalog, "SWEATSHIRT-M"),
      shippingOptionId: catalog.shippingOptionId,
      email: "s14-buyer@einvoice-e2e.example",
      customerToken: customer.token,
      address: {
        firstName: "Claire",
        lastName: "Exemple",
        addressLine1: "2 Rue de Lyon",
        city: "Lyon",
        postalCode: "69001",
        countryCode: "fr",
        company: "Exemple SAS",
      },
    });

    await fulfillOrder(admin, orderId, catalog.stockLocationId);
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
    expect(refusal.code).toBe("TaxRuleError");
    expect(refusal.message).toContain("positive VIES check");
    expect((await getEinvoiceStatus(admin, orderId)).documents).toEqual([]);

    expect((await retryRefusal(admin, refusal)).outcome).toBe("blocked");

    await setOrderMetadata(admin, orderId, {
      regime_override: {
        kind: "intra-eu-confirmed",
        evidenceNote: "VAT-ID confirmed with the French tax office by phone",
      },
    });
    const retried = await retryRefusal(admin, refusal);
    expect(retried.outcome).toBe("issued");

    const status = await getEinvoiceStatus(admin, orderId);
    expect(status.refusals).toEqual([]);
    const invoice = status.documents.find((d) => d.type === "invoice");
    if (invoice === undefined) {
      throw new Error("the retry reported an invoice, but none is listed");
    }
    const xmlBytes = await downloadEinvoiceFile(admin, orderId, invoice.id, "xml");
    const xml = xmlBytes.toString("utf-8");
    expect(bt.vatCategoryCode(xml)).toBe("K");
    expect(bt.buyerVatId(xml)).toBe(UNAVAILABLE_VAT_ID);
    const report = await validateBytes(xmlBytes, "s14-invoice.xml");
    expect(report.valid, JSON.stringify(report.messages)).toBe(true);
    expect(report.accepted, JSON.stringify(report.messages)).toBe(true);
  });
});
