import { beforeAll, describe, expect, it } from "vitest";
import { adminLogin, type AdminSession } from "../api/admin.js";
import { checkoutToOrder } from "../api/checkout.js";
import { downloadEinvoiceFile, fulfillOrder, listEinvoiceDocuments } from "../api/orders.js";
import { capturePayment, getOrderPayment, refundPayment } from "../api/payments.js";
import { loadCatalog, requireVariantId, type Catalog } from "../seed/catalog.js";
import { waitFor } from "../harness/wait-for.js";
import * as bt from "../assert/bt.js";
import { validateBytes } from "../assert/conformance.js";

// S5 (P-41): a partial refund credits its own amount, not the whole order. Before P-41 every refund
// restated the whole order, so a refund of 5 on an invoice of 23.80 produced a credit note of 23.80.
describe("S5: partial refund -> credit note for the refunded amount", () => {
  let admin: AdminSession;
  let catalog: Catalog;

  beforeAll(async () => {
    admin = await adminLogin();
    catalog = await loadCatalog(admin);
  }, 60_000);

  it("produces a one-line, KoSIT-green credit note of exactly the refunded amount", async () => {
    const { orderId } = await checkoutToOrder({
      publishableKey: catalog.publishableKey,
      regionId: catalog.regionId,
      salesChannelId: catalog.salesChannelId,
      variantId: requireVariantId(catalog, "SHIRT-S-BLACK"),
      shippingOptionId: catalog.shippingOptionId,
      email: "s5-buyer@einvoice-e2e.example",
      address: {
        firstName: "Erika",
        lastName: "Musterfrau",
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
        return documents.some((d) => d.type === "invoice");
      },
      { timeoutMs: 30_000 },
    );
    const invoice = documents.find((d) => d.type === "invoice");
    if (invoice === undefined) {
      throw new Error("unreachable: waitFor guarantees an invoice document exists");
    }

    const payment = await getOrderPayment(admin, orderId);
    await capturePayment(admin, payment.id);
    await refundPayment(admin, payment.id, 5);

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
    expect(bt.lineCount(xml)).toBe(1);
    // 4.20 net + 0.80 VAT (19%) = 5.00 — exactly what was refunded.
    expect(bt.grandTotalAmount(xml)).toBeCloseTo(5, 2);

    const report = await validateBytes(xmlBytes, "s5-credit-note.xml");
    expect(report.valid, JSON.stringify(report.messages)).toBe(true);
    expect(report.accepted, JSON.stringify(report.messages)).toBe(true);
  });
});
