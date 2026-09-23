import { beforeAll, describe, expect, it } from "vitest";
import { adminLogin, type AdminSession } from "../api/admin.js";
import { registerCustomer, setCustomerMetadata } from "../api/customer.js";
import { checkoutToOrder } from "../api/checkout.js";
import { downloadEinvoiceFile, fulfillOrder, getOrder, waitForDocumentXml } from "../api/orders.js";
import { loadCatalog, requireVariantId, type Catalog } from "../seed/catalog.js";
import * as bt from "../assert/bt.js";
import { validateBytes } from "../assert/conformance.js";

/** The worked example of the KoSIT "Leitweg-ID Format-Spezifikation Version 2.0.2" (§2.4) — synthetic. */
const LEITWEG_ID = "04011000-1234512345-06";

// S11 (P-59 item 5, P-54): a German public-sector buyer. The merchant declares the Leitweg-ID on the
// customer (`customer.metadata.leitweg_id`); it has to reach BT-10 and route the document to the XRechnung
// profile — the one path where a single metadata key decides the format, and which the fixture matrix
// only models with a synthetic order.
describe("S11: DE public-sector buyer with a Leitweg-ID -> XRechnung", () => {
  let admin: AdminSession;
  let catalog: Catalog;

  beforeAll(async () => {
    admin = await adminLogin();
    catalog = await loadCatalog(admin);
  }, 60_000);

  it("puts the declared Leitweg-ID into BT-10 and embeds the document under the XRechnung profile", async () => {
    const customer = await registerCustomer(catalog.publishableKey, {
      email: "s11-buyer@einvoice-e2e.example",
      password: "s11-buyer-password",
      companyName: "Stadtverwaltung Musterstadt",
    });
    await setCustomerMetadata(admin, customer.customerId, { leitweg_id: LEITWEG_ID });

    const { orderId } = await checkoutToOrder({
      publishableKey: catalog.publishableKey,
      regionId: catalog.regionId,
      salesChannelId: catalog.salesChannelId,
      variantId: requireVariantId(catalog, "SHIRT-S-BLACK"),
      shippingOptionId: catalog.shippingOptionId,
      email: "s11-buyer@einvoice-e2e.example",
      customerToken: customer.token,
      address: {
        firstName: "Erika",
        lastName: "Beispiel",
        addressLine1: "Rathausplatz 1",
        city: "Berlin",
        postalCode: "10117",
        countryCode: "de",
        company: "Stadtverwaltung Musterstadt",
      },
    });

    await fulfillOrder(admin, orderId, catalog.stockLocationId);
    const { document, xmlBytes } = await waitForDocumentXml(admin, orderId, "invoice");
    const xml = xmlBytes.toString("utf-8");

    expect(bt.buyerReference(xml)).toBe(LEITWEG_ID);
    expect(bt.vatCategoryCode(xml)).toBe("S");
    const order = await getOrder(admin, orderId);
    expect(bt.grandTotalAmount(xml)).toBeCloseTo(order.total, 2);

    const xmlReport = await validateBytes(xmlBytes, "s11-invoice.xml");
    expect(xmlReport.valid, JSON.stringify(xmlReport.messages)).toBe(true);
    expect(xmlReport.accepted, JSON.stringify(xmlReport.messages)).toBe(true);

    // The profile shows in the hybrid PDF: the XRechnung attachment name and the XMP conformance level
    // (the metadata stream of a PDF/A file is never compressed).
    expect(document.pdfUrl).not.toBeNull();
    const pdf = (await downloadEinvoiceFile(admin, orderId, document.id, "pdf")).toString("latin1");
    expect(pdf).toContain("xrechnung.xml");
    expect(pdf).toMatch(/:ConformanceLevel>XRECHNUNG</);
  });
});
