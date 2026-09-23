import { beforeAll, describe, expect, it } from "vitest";
import { adminLogin, type AdminSession } from "../api/admin.js";
import { checkoutToOrder } from "../api/checkout.js";
import {
  downloadEinvoiceFile,
  fulfillOrder,
  getOrder,
  listEinvoiceDocuments,
  type EinvoiceDocumentSummary,
} from "../api/orders.js";
import { loadCatalog, requireVariantId, type Catalog } from "../seed/catalog.js";
import { waitFor } from "../harness/wait-for.js";
import * as bt from "../assert/bt.js";
import { validateBytes } from "../assert/conformance.js";

// S1 (plan-e2e.md §4): a domestic DE→DE B2B order — the plan's own designated PDF/A-3b scenario, the only
// one that pays the extra runtime for a full veraPDF check (the rest stay XML-only).
describe("S1: DE -> DE B2B, 19%", () => {
  let admin: AdminSession;
  let catalog: Catalog;

  beforeAll(async () => {
    admin = await adminLogin();
    catalog = await loadCatalog(admin);
  }, 60_000);

  it("produces a KoSIT- and veraPDF-green invoice with the right BT values", async () => {
    const { orderId } = await checkoutToOrder({
      publishableKey: catalog.publishableKey,
      regionId: catalog.regionId,
      salesChannelId: catalog.salesChannelId,
      variantId: requireVariantId(catalog, "SHIRT-S-BLACK"),
      shippingOptionId: catalog.shippingOptionId,
      email: "s1-buyer@einvoice-e2e.example",
      address: {
        firstName: "Max",
        lastName: "Mustermann",
        addressLine1: "Teststr. 1",
        city: "Berlin",
        postalCode: "10115",
        countryCode: "de",
        company: "Musterfirma GmbH",
      },
    });

    await fulfillOrder(admin, orderId, catalog.stockLocationId);

    let documents: readonly EinvoiceDocumentSummary[] = [];
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
    expect(document.pdfUrl).not.toBeNull();

    const xmlBytes = await downloadEinvoiceFile(admin, orderId, document.id, "xml");
    const xml = xmlBytes.toString("utf-8");

    const order = await getOrder(admin, orderId);
    expect(bt.invoiceNumber(xml)).toBe(document.documentNumber);
    expect(bt.typeCode(xml)).toBe("380");
    expect(bt.vatCategoryCode(xml)).toBe("S");
    // The seeded "SHIRT-S-BLACK" variant (EUR 10) plus the seeded "Standard Shipping" option (EUR 10), both
    // at the standard 19% DE rate: shipping is on the invoice as a document-level charge (P-39) and takes
    // the rate of the goods it ships (P-40). Not compared with `order.total`: this stand's tax regions carry
    // no rate, so Medusa itself charged no VAT at all — the subscriber logs exactly that mismatch.
    expect(bt.shippingChargeAmount(xml)).toBeCloseTo(10, 2);
    expect(bt.grandTotalAmount(xml)).toBeCloseTo(23.8, 2);
    expect(order.currencyCode).toBe("eur");

    const xmlReport = await validateBytes(xmlBytes, "s1-invoice.xml");
    expect(xmlReport.valid, JSON.stringify(xmlReport.messages)).toBe(true);
    expect(xmlReport.accepted, JSON.stringify(xmlReport.messages)).toBe(true);

    const pdfBytes = await downloadEinvoiceFile(admin, orderId, document.id, "pdf");
    const pdfReport = await validateBytes(pdfBytes, "s1-invoice.pdf");
    expect(pdfReport.valid, JSON.stringify(pdfReport.messages)).toBe(true);
  });
});
