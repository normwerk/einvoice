import { beforeAll, describe, expect, it } from "vitest";
import { adminLogin, type AdminSession } from "../api/admin.js";
import { registerCustomer, setCustomerVatId } from "../api/customer.js";
import { checkoutToOrder } from "../api/checkout.js";
import {
  downloadEinvoiceFile,
  fulfillOrder,
  getEinvoiceStatus,
  getOrder,
  listEinvoiceDocuments,
  waitForDocumentXml,
} from "../api/orders.js";
import { capturePayment, getOrderPayment, refundPayment } from "../api/payments.js";
import { loadCatalog, requireVariantId, type Catalog } from "../seed/catalog.js";
import { waitFor } from "../harness/wait-for.js";
import { VALID_VAT_ID } from "../harness/env.js";
import * as bt from "../assert/bt.js";
import { validateBytes } from "../assert/conformance.js";

// S12 (P-63): Medusa charges VAT the invoice does not state. A business buyer with a verified VAT-ID gets
// a delivery to Spain, where the stand charges 21% — Medusa knows nothing of intra-EU reverse charge — while
// the invoice is category K at 0%. The invoice is issued, with a notice of what the buyer overpaid; the
// refund of that overpayment issues no credit note, and a refund beyond it credits only its own amount.
// (The stand's verifier knows one VAT-ID, a French one: category K needs a VAT-ID of another member state
// than Germany, not of the destination.)
describe("S12: VAT charged that the invoice does not state -> issued with a notice", () => {
  let admin: AdminSession;
  let catalog: Catalog;

  beforeAll(async () => {
    admin = await adminLogin();
    catalog = await loadCatalog(admin);
  }, 60_000);

  it("issues the K invoice with a refund-due notice; refunding the overpayment credits nothing", async () => {
    const customer = await registerCustomer(catalog.publishableKey, {
      email: "s12-buyer@einvoice-e2e.example",
      password: "s12-buyer-password",
      companyName: "Ejemplo S.L.",
    });
    await setCustomerVatId(admin, customer.customerId, VALID_VAT_ID);
    const { orderId } = await checkoutToOrder({
      publishableKey: catalog.publishableKey,
      regionId: catalog.regionId,
      salesChannelId: catalog.salesChannelId,
      variantId: requireVariantId(catalog, "SWEATSHIRT-M"),
      shippingOptionId: catalog.shippingOptionId,
      email: "s12-buyer@einvoice-e2e.example",
      customerToken: customer.token,
      address: {
        firstName: "Lucía",
        lastName: "Ejemplo",
        addressLine1: "Calle Mayor 1",
        city: "Madrid",
        postalCode: "28013",
        countryCode: "es",
        company: "Ejemplo S.L.",
      },
    });
    const order = await getOrder(admin, orderId);
    expect(order.taxTotal).toBeGreaterThan(0);

    await fulfillOrder(admin, orderId, catalog.stockLocationId);
    const { document: invoice, xmlBytes } = await waitForDocumentXml(admin, orderId, "invoice");
    const xml = xmlBytes.toString("utf-8");
    expect(bt.vatCategoryCode(xml)).toBe("K");
    expect(bt.taxTotalAmount(xml)).toBe(0);
    // The buyer paid the Spanish VAT on top of the invoice total.
    expect(bt.grandTotalAmount(xml)).toBeCloseTo(order.total - order.taxTotal, 2);

    const status = await getEinvoiceStatus(admin, orderId);
    expect(status.refusals).toEqual([]);
    const notice = status.documents.find((d) => d.id === invoice.id)?.notice;
    expect(notice?.code).toBe("VAT_OVERCHARGED");
    const refundDue = Number(notice?.details["refundDue"]);
    expect(refundDue).toBeCloseTo(order.taxTotal, 2);
    expect(notice?.message).toContain(`overpaid ${refundDue.toFixed(2)}`);

    const report = await validateBytes(xmlBytes, "s12-invoice.xml");
    expect(report.valid, JSON.stringify(report.messages)).toBe(true);
    expect(report.accepted, JSON.stringify(report.messages)).toBe(true);

    // The overpayment back, then 5.00 more: one credit note, of 5.00.
    const payment = await getOrderPayment(admin, orderId);
    await capturePayment(admin, payment.id);
    await refundPayment(admin, payment.id, refundDue);
    await refundPayment(admin, payment.id, 5);

    let documents = await listEinvoiceDocuments(admin, orderId);
    await waitFor(
      `credit note for order ${orderId}`,
      async () => {
        documents = await listEinvoiceDocuments(admin, orderId);
        return documents.some((d) => d.type === "credit_note");
      },
      { timeoutMs: 30_000 },
    );
    const creditNotes = documents.filter((d) => d.type === "credit_note");
    expect(creditNotes).toHaveLength(1);
    const creditNote = creditNotes[0];
    if (creditNote === undefined) {
      throw new Error("unreachable: one credit note asserted above");
    }
    const creditXmlBytes = await downloadEinvoiceFile(admin, orderId, creditNote.id, "xml");
    const creditXml = creditXmlBytes.toString("utf-8");
    expect(bt.grandTotalAmount(creditXml)).toBeCloseTo(5, 2);
    expect(bt.vatCategoryCode(creditXml)).toBe("K");
    expect(bt.correctedInvoiceNumber(creditXml)).toBe(invoice.documentNumber);
    const creditReport = await validateBytes(creditXmlBytes, "s12-credit-note.xml");
    expect(creditReport.valid, JSON.stringify(creditReport.messages)).toBe(true);
    expect(creditReport.accepted, JSON.stringify(creditReport.messages)).toBe(true);
  });
});
