import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminLogin, type AdminSession } from "../api/admin.js";
import { checkoutToOrder } from "../api/checkout.js";
import { productIdOfVariant } from "../api/catalog-admin.js";
import {
  cancelOrder,
  downloadEinvoiceFile,
  fulfillOrder,
  getEinvoiceStatus,
  listEinvoiceDocuments,
  waitForDocumentXml,
  type EinvoiceDocumentSummary,
} from "../api/orders.js";
import { capturePayment, getOrderPayment, refundPayment } from "../api/payments.js";
import { getOrderItemValues, receiveReturn } from "../api/returns.js";
import { createProductTaxRate, deleteTaxRate } from "../api/tax.js";
import { loadCatalog, requireVariantId, type Catalog } from "../seed/catalog.js";
import { waitFor } from "../harness/wait-for.js";
import * as bt from "../assert/bt.js";
import { validateBytes } from "../assert/conformance.js";

// S15 (P-65): a basket at two rates — the stand charges 7% on the sweatpants for this scenario (a product
// tax rate override, standing in for a book) and 19% on the shirt. Shipping is split across the two rates on
// the invoice, in proportion to the lines; Medusa taxes it at one rate, so the invoice carries the P-63
// notice naming that cause. Credits: a received return is paid for at its own rate first, a goodwill refund
// without goods is split across both rates, and a cancellation credits what is left at each rate.
describe("S15: mixed 7 % / 19 % basket — shipping split, credits per rate", () => {
  let admin: AdminSession;
  let catalog: Catalog;
  let taxRateId: string | undefined;
  let reducedVariantId: string;

  beforeAll(async () => {
    admin = await adminLogin();
    catalog = await loadCatalog(admin);
    reducedVariantId = requireVariantId(catalog, "SWEATPANTS-M");
    const productId = await productIdOfVariant(admin, reducedVariantId);
    taxRateId = await createProductTaxRate(admin, "de", productId, 7);
  }, 60_000);

  afterAll(async () => {
    // The override would tax the sweatpants at 7% in every later scenario.
    if (taxRateId !== undefined) {
      await deleteTaxRate(admin, taxRateId);
    }
  });

  async function invoicedMixedOrder(email: string): Promise<{
    readonly orderId: string;
    readonly invoice: EinvoiceDocumentSummary;
    readonly xml: string;
  }> {
    const { orderId } = await checkoutToOrder({
      publishableKey: catalog.publishableKey,
      regionId: catalog.regionId,
      salesChannelId: catalog.salesChannelId,
      variantId: requireVariantId(catalog, "SHIRT-S-BLACK"),
      extraItems: [{ variantId: reducedVariantId }],
      shippingOptionId: catalog.shippingOptionId,
      email,
      address: {
        firstName: "Erika",
        lastName: "Musterfrau",
        addressLine1: "Teststr. 15",
        city: "Leipzig",
        postalCode: "04109",
        countryCode: "de",
        company: "Musterfirma GmbH",
      },
    });
    await fulfillOrder(admin, orderId, catalog.stockLocationId);
    const { document, xmlBytes } = await waitForDocumentXml(admin, orderId, "invoice");
    const report = await validateBytes(xmlBytes, `${email}-invoice.xml`);
    expect(report.valid, JSON.stringify(report.messages)).toBe(true);
    expect(report.accepted, JSON.stringify(report.messages)).toBe(true);
    return { orderId, invoice: document, xml: xmlBytes.toString("utf-8") };
  }

  async function waitForCreditNotes(
    orderId: string,
    count: number,
  ): Promise<readonly EinvoiceDocumentSummary[]> {
    let creditNotes: readonly EinvoiceDocumentSummary[] = [];
    await waitFor(
      `${count} credit note(s) for order ${orderId}`,
      async () => {
        creditNotes = (await listEinvoiceDocuments(admin, orderId)).filter(
          (d) => d.type === "credit_note",
        );
        return creditNotes.length >= count;
      },
      { timeoutMs: 30_000 },
    );
    expect(creditNotes).toHaveLength(count);
    return creditNotes;
  }

  async function validatedXml(
    orderId: string,
    document: EinvoiceDocumentSummary,
    name: string,
  ): Promise<string> {
    const bytes = await downloadEinvoiceFile(admin, orderId, document.id, "xml");
    const report = await validateBytes(bytes, name);
    expect(report.valid, JSON.stringify(report.messages)).toBe(true);
    expect(report.accepted, JSON.stringify(report.messages)).toBe(true);
    return bytes.toString("utf-8");
  }

  it("splits shipping across the rates, then credits a return at its own rate and a goodwill refund at both", async () => {
    const { orderId, invoice, xml } = await invoicedMixedOrder("s15-return@einvoice-e2e.example");

    const charges = bt.documentCharges(xml);
    expect(charges.map((c) => c.rate).sort()).toEqual(["19", "7"]);
    expect(charges.every((c) => c.reason.includes("anteilig"))).toBe(true);
    const invoiceByRate = bt.grossByRate(xml);

    const notice = (await getEinvoiceStatus(admin, orderId)).documents.find(
      (d) => d.id === invoice.id,
    )?.notice;
    expect(notice?.code).toBe("VAT_OVERCHARGED");
    expect(notice?.details["cause"]).toBe("shipping-split-across-rates");
    const refundDue = Number(notice?.details["refundDue"]);
    expect(refundDue).toBeGreaterThan(0);

    const payment = await getOrderPayment(admin, orderId);
    await capturePayment(admin, payment.id);
    // The overpaid shipping VAT back, as the notice asks: no credit note.
    await refundPayment(admin, payment.id, refundDue);

    // The sweatpants come back and are received; their refund is credited at 7%.
    const reduced = (await getOrderItemValues(admin, orderId)).find(
      (item) => item.variantId === reducedVariantId,
    );
    if (reduced === undefined) {
      throw new Error("the order has no reduced-rate line");
    }
    await receiveReturn(admin, orderId, catalog.stockLocationId, [
      { itemId: reduced.id, quantity: 1 },
    ]);
    await refundPayment(admin, payment.id, reduced.total);
    const [returnCredit] = await waitForCreditNotes(orderId, 1);
    if (returnCredit === undefined) throw new Error("unreachable");
    const returnXml = await validatedXml(orderId, returnCredit, "s15-return-credit.xml");
    expect(bt.grossByRate(returnXml)).toEqual({ "7": reduced.total });
    expect(bt.lineNames(returnXml)[0]).toContain("Rückgabe");
    expect(bt.correctedInvoiceNumber(returnXml)).toBe(invoice.documentNumber);

    // A goodwill refund without goods: split across both rates, in proportion to what is left of each.
    await refundPayment(admin, payment.id, 5);
    const creditNotes = await waitForCreditNotes(orderId, 2);
    const goodwill = creditNotes.find((d) => d.id !== returnCredit.id);
    if (goodwill === undefined) throw new Error("unreachable");
    const goodwillXml = await validatedXml(orderId, goodwill, "s15-goodwill-credit.xml");
    const goodwillByRate = bt.grossByRate(goodwillXml);
    expect(Object.keys(goodwillByRate).sort()).toEqual(["19", "7"]);
    expect((goodwillByRate["19"] ?? 0) + (goodwillByRate["7"] ?? 0)).toBeCloseTo(5, 2);
    // The 7% share follows what was still uncredited at 7% — the invoice's 7% less the returned goods.
    const left19 = invoiceByRate["19"] ?? 0;
    const left7 = (invoiceByRate["7"] ?? 0) - reduced.total;
    expect(goodwillByRate["7"]).toBeCloseTo((5 * left7) / (left19 + left7), 1);
    expect(bt.lineNames(goodwillXml).every((name) => name.includes("anteilig"))).toBe(true);
  });

  it("credits the rest of a cancelled mixed order at each rate, after a partial refund", async () => {
    const { orderId, xml } = await invoicedMixedOrder("s15-cancel@einvoice-e2e.example");
    const invoiceTotal = bt.grandTotalAmount(xml);

    const payment = await getOrderPayment(admin, orderId);
    await capturePayment(admin, payment.id);
    await refundPayment(admin, payment.id, 5);
    const [partial] = await waitForCreditNotes(orderId, 1);
    if (partial === undefined) throw new Error("unreachable");
    const partialXml = await validatedXml(orderId, partial, "s15-partial-credit.xml");

    await cancelOrder(admin, orderId);
    const creditNotes = await waitForCreditNotes(orderId, 2);
    const rest = creditNotes.find((d) => d.id !== partial.id);
    if (rest === undefined) throw new Error("unreachable");
    const restXml = await validatedXml(orderId, rest, "s15-cancellation-credit.xml");
    expect(Object.keys(bt.grossByRate(restXml)).sort()).toEqual(["19", "7"]);
    expect(bt.lineNames(restXml).every((name) => name.includes("Stornierung Restbetrag"))).toBe(
      true,
    );
    // Together the two credit notes restate the invoice, rate by rate.
    const invoiceByRate = bt.grossByRate(xml);
    for (const rate of ["19", "7"]) {
      expect(
        (bt.grossByRate(partialXml)[rate] ?? 0) + (bt.grossByRate(restXml)[rate] ?? 0),
      ).toBeCloseTo(invoiceByRate[rate] ?? 0, 2);
    }
    expect(bt.grandTotalAmount(partialXml) + bt.grandTotalAmount(restXml)).toBeCloseTo(
      invoiceTotal,
      2,
    );
  });
});
