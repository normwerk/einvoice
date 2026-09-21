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
    // Item price is a fixed EUR 10 (the seeded "SHIRT-S-BLACK" variant, docs/... initial-data-seed.ts) at
    // the standard 19% DE rate — a precise, self-contained expectation, not `order.total` (which also
    // includes an untaxed shipping fee this plugin does not currently put on the invoice at all; a real,
    // separate finding flagged for follow-up, not something this assertion should paper over).
    expect(bt.grandTotalAmount(xml)).toBeCloseTo(11.9, 2);
    expect(order.currencyCode).toBe("eur");

    const xmlReport = await validateBytes(xmlBytes, "s1-invoice.xml");
    expect(xmlReport.valid, JSON.stringify(xmlReport.messages)).toBe(true);
    expect(xmlReport.accepted, JSON.stringify(xmlReport.messages)).toBe(true);

    const pdfBytes = await downloadEinvoiceFile(admin, orderId, document.id, "pdf");
    const pdfReport = await validateBytes(pdfBytes, "s1-invoice.pdf");
    expect(pdfReport.valid, JSON.stringify(pdfReport.messages)).toBe(true);
  });
});
