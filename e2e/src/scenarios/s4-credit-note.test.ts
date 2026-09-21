import { beforeAll, describe, expect, it } from "vitest";
import { adminLogin, type AdminSession } from "../api/admin.js";
import { checkoutToOrder } from "../api/checkout.js";
import { downloadEinvoiceFile, fulfillOrder, listEinvoiceDocuments } from "../api/orders.js";
import { capturePayment, getOrderPayment, refundPayment } from "../api/payments.js";
import { loadCatalog, requireVariantId, type Catalog } from "../seed/catalog.js";
import { waitFor } from "../harness/wait-for.js";
import * as bt from "../assert/bt.js";
import { validateBytes } from "../assert/conformance.js";

// S4 (plan-e2e.md §4): a return on an S1-shaped domestic order — full refund, credit note (381)
// referencing the original invoice (BT-25).
describe("S4: return -> credit note", () => {
  let admin: AdminSession;
  let catalog: Catalog;

  beforeAll(async () => {
    admin = await adminLogin();
    catalog = await loadCatalog(admin);
  }, 60_000);

  it("produces a KoSIT-green credit note referencing the original invoice", async () => {
    const { orderId } = await checkoutToOrder({
      publishableKey: catalog.publishableKey,
      regionId: catalog.regionId,
      salesChannelId: catalog.salesChannelId,
      variantId: requireVariantId(catalog, "SWEATPANTS-M"),
      shippingOptionId: catalog.shippingOptionId,
      email: "s4-buyer@einvoice-e2e.example",
      address: {
        firstName: "Erika",
        lastName: "Musterfrau",
        addressLine1: "Teststr. 2",
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
    await refundPayment(admin, payment.id, payment.amount);

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
      throw new Error("unreachable: waitFor guarantees a credit_note document exists");
    }

    const xmlBytes = await downloadEinvoiceFile(admin, orderId, creditNote.id, "xml");
    const xml = xmlBytes.toString("utf-8");

    expect(bt.typeCode(xml)).toBe("381");
    expect(bt.correctedInvoiceNumber(xml)).toBe(invoice.documentNumber);

    const report = await validateBytes(xmlBytes, "s4-credit-note.xml");
    expect(report.valid, JSON.stringify(report.messages)).toBe(true);
    expect(report.accepted, JSON.stringify(report.messages)).toBe(true);
  });
});
