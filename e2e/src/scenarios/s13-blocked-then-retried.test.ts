import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminLogin, type AdminSession } from "../api/admin.js";
import { checkoutToOrder } from "../api/checkout.js";
import {
  downloadEinvoiceFile,
  fulfillOrder,
  getEinvoiceStatus,
  getOrder,
  retryRefusal,
  type EinvoiceRefusalSummary,
} from "../api/orders.js";
import { createShippingOptionTaxRate, deleteTaxRate } from "../api/tax.js";
import { capturePayment, getOrderPayment, refundPayment } from "../api/payments.js";
import { loadCatalog, requireVariantId, type Catalog } from "../seed/catalog.js";
import { waitFor } from "../harness/wait-for.js";
import { recomputeShippingTaxLines } from "../harness/exec-in-medusa.js";
import * as bt from "../assert/bt.js";
import { validateBytes } from "../assert/conformance.js";

// S13 (P-63): the invoice would state more VAT than Medusa charged, so it is not issued. The shop charges
// no VAT on shipping (a 0% override on the shipping option), while shipping follows the goods' 19% on the
// invoice. The refusal is visible through the admin API with its code and amounts, and no number is taken.
// The merchant then corrects the shop — removes the override — and the order, by recomputing its shipping's
// tax lines (`updateOrderTaxLinesWorkflow`, the way Medusa documents it); the retry issues the invoice.
// P-66: a refund made while the invoice was not issued is refused too (no invoice to correct) and credited
// by its own retry once the invoice exists.
describe("S13: invoice VAT above what Medusa charged -> not issued, corrected, retried", () => {
  let admin: AdminSession;
  let catalog: Catalog;
  let taxRateId: string | undefined;

  beforeAll(async () => {
    admin = await adminLogin();
    catalog = await loadCatalog(admin);
    taxRateId = await createShippingOptionTaxRate(admin, "de", catalog.shippingOptionId, 0);
  }, 60_000);

  afterAll(async () => {
    // The override would untax shipping for every later scenario; removed even when this one fails.
    if (taxRateId !== undefined) {
      await deleteTaxRate(admin, taxRateId);
    }
  });

  it("records why, and issues the invoice on retry once the order is corrected", async () => {
    const { orderId } = await checkoutToOrder({
      publishableKey: catalog.publishableKey,
      regionId: catalog.regionId,
      salesChannelId: catalog.salesChannelId,
      variantId: requireVariantId(catalog, "SHIRT-S-BLACK"),
      shippingOptionId: catalog.shippingOptionId,
      email: "s13-buyer@einvoice-e2e.example",
      address: {
        firstName: "Max",
        lastName: "Mustermann",
        addressLine1: "Teststr. 13",
        city: "Köln",
        postalCode: "50667",
        countryCode: "de",
        company: "Mustermann GmbH",
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
    expect(refusal.code).toBe("INVOICE_VAT_ABOVE_CHARGED");
    expect(Number(refusal.details["invoicedVat"])).toBeGreaterThan(
      Number(refusal.details["chargedVat"]),
    );
    expect(refusal.message).toContain("Not issued");
    expect((await getEinvoiceStatus(admin, orderId)).documents).toEqual([]);

    // Still blocked while the order is unchanged.
    expect((await retryRefusal(admin, refusal)).outcome).toBe("blocked");

    // A refund meanwhile: no invoice to correct yet, so its credit note is refused and recorded.
    const payment = await getOrderPayment(admin, orderId);
    await capturePayment(admin, payment.id);
    await refundPayment(admin, payment.id, 5);
    let creditRefusal: EinvoiceRefusalSummary | undefined;
    await waitFor(
      `credit note refusal for order ${orderId}`,
      async () => {
        creditRefusal = (await getEinvoiceStatus(admin, orderId)).refusals.find(
          (r) => r.type === "credit_note",
        );
        return creditRefusal !== undefined;
      },
      { timeoutMs: 30_000 },
    );
    if (creditRefusal === undefined) {
      throw new Error("unreachable: waitFor guarantees a credit note refusal");
    }
    expect(creditRefusal.code).toBe("MissingOriginalInvoiceError");

    if (taxRateId !== undefined) {
      await deleteTaxRate(admin, taxRateId);
      taxRateId = undefined;
    }
    await recomputeShippingTaxLines(orderId);

    const retried = await retryRefusal(admin, refusal);
    expect(retried.outcome).toBe("issued");

    const status = await getEinvoiceStatus(admin, orderId);
    expect(status.refusals.map((r) => r.type)).toEqual(["credit_note"]);
    const invoice = status.documents.find((d) => d.type === "invoice");
    if (invoice === undefined) {
      throw new Error("the retry reported an invoice, but none is listed");
    }
    expect(invoice.documentNumber).toBe(retried.documentNumber);
    expect(invoice.notice).toBeNull();

    const xmlBytes = await downloadEinvoiceFile(admin, orderId, invoice.id, "xml");
    const xml = xmlBytes.toString("utf-8");
    const order = await getOrder(admin, orderId);
    // Medusa records the refund as a credit line and takes it off `total`.
    expect(bt.grandTotalAmount(xml)).toBeCloseTo(order.total + order.creditLineTotal, 2);
    expect(bt.taxTotalAmount(xml)).toBeCloseTo(order.taxTotal, 2);
    const report = await validateBytes(xmlBytes, "s13-invoice.xml");
    expect(report.valid, JSON.stringify(report.messages)).toBe(true);
    expect(report.accepted, JSON.stringify(report.messages)).toBe(true);

    // The invoice exists now: the credit note's retry credits the refund.
    const creditRetried = await retryRefusal(admin, creditRefusal);
    expect(creditRetried.outcome).toBe("issued");
    const after = await getEinvoiceStatus(admin, orderId);
    expect(after.refusals).toEqual([]);
    const creditNote = after.documents.find((d) => d.type === "credit_note");
    if (creditNote === undefined) {
      throw new Error("the retry reported a credit note, but none is listed");
    }
    const creditXmlBytes = await downloadEinvoiceFile(admin, orderId, creditNote.id, "xml");
    const creditXml = creditXmlBytes.toString("utf-8");
    expect(bt.grandTotalAmount(creditXml)).toBeCloseTo(5, 2);
    expect(bt.correctedInvoiceNumber(creditXml)).toBe(invoice.documentNumber);
    const creditReport = await validateBytes(creditXmlBytes, "s13-credit-note.xml");
    expect(creditReport.valid, JSON.stringify(creditReport.messages)).toBe(true);
    expect(creditReport.accepted, JSON.stringify(creditReport.messages)).toBe(true);
  });
});
