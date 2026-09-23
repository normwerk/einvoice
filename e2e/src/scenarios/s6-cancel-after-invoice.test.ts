import { beforeAll, describe, expect, it } from "vitest";
import { adminLogin, type AdminSession } from "../api/admin.js";
import { checkoutToOrder } from "../api/checkout.js";
import {
  cancelOrder,
  downloadEinvoiceFile,
  fulfillOrder,
  listEinvoiceDocuments,
} from "../api/orders.js";
import { loadCatalog, requireVariantId, type Catalog } from "../seed/catalog.js";
import { waitFor } from "../harness/wait-for.js";
import * as bt from "../assert/bt.js";
import { validateBytes } from "../assert/conformance.js";

// S6 (P-41): an invoiced order that is then cancelled gets a credit note. Medusa cancels an order only
// after its fulfillments are cancelled, and its cancelOrderWorkflow emits order.canceled — not
// payment.refunded — so before P-41 such an order kept its invoice uncorrected.
describe("S6: cancellation after the invoice -> credit note", () => {
  let admin: AdminSession;
  let catalog: Catalog;

  beforeAll(async () => {
    admin = await adminLogin();
    catalog = await loadCatalog(admin);
  }, 60_000);

  it("reverses the whole invoice with a KoSIT-green credit note", async () => {
    const { orderId } = await checkoutToOrder({
      publishableKey: catalog.publishableKey,
      regionId: catalog.regionId,
      salesChannelId: catalog.salesChannelId,
      variantId: requireVariantId(catalog, "SHIRT-S-BLACK"),
      shippingOptionId: catalog.shippingOptionId,
      email: "s6-buyer@einvoice-e2e.example",
      address: {
        firstName: "Max",
        lastName: "Mustermann",
        addressLine1: "Teststr. 6",
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
        return documents.some((d) => d.type === "invoice");
      },
      { timeoutMs: 30_000 },
    );
    const invoice = documents.find((d) => d.type === "invoice");
    if (invoice === undefined) {
      throw new Error("unreachable: waitFor guarantees an invoice document exists");
    }
    const invoiceXml = (await downloadEinvoiceFile(admin, orderId, invoice.id, "xml")).toString(
      "utf-8",
    );

    await cancelOrder(admin, orderId);

    await waitFor(
      `credit note for order ${orderId}`,
      async () => {
        documents = await listEinvoiceDocuments(admin, orderId);
        return documents.some((d) => d.type === "credit_note");
      },
      { timeoutMs: 30_000 },
    );
    const creditNote = documents.find((d) => d.type === "credit_note");
    if (creditNote === undefined) {
      throw new Error("unreachable: waitFor guarantees a credit note document exists");
    }

    const xmlBytes = await downloadEinvoiceFile(admin, orderId, creditNote.id, "xml");
    const xml = xmlBytes.toString("utf-8");
    expect(bt.typeCode(xml)).toBe("381");
    expect(bt.correctedInvoiceNumber(xml)).toBe(invoice.documentNumber);
    expect(bt.grandTotalAmount(xml)).toBeCloseTo(bt.grandTotalAmount(invoiceXml), 2);

    const report = await validateBytes(xmlBytes, "s6-credit-note.xml");
    expect(report.valid, JSON.stringify(report.messages)).toBe(true);
    expect(report.accepted, JSON.stringify(report.messages)).toBe(true);
  });
});
