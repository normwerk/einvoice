import { beforeAll, describe, expect, it } from "vitest";
import { adminLogin, type AdminSession } from "../api/admin.js";
import { checkoutToOrder } from "../api/checkout.js";
import {
  downloadEinvoiceFile,
  getEinvoiceStatus,
  getOrder,
  listEinvoiceDocuments,
  type EinvoiceDocumentSummary,
  type EinvoiceRefusalSummary,
} from "../api/orders.js";
import { cancelFulfillment, fulfillItems, listFulfillments } from "../api/fulfillments.js";
import { getOrderItemValues, receiveReturn } from "../api/returns.js";
import { capturePayment, getOrderPayment, refundPayment } from "../api/payments.js";
import { loadCatalog, requireVariantId, type Catalog } from "../seed/catalog.js";
import { waitFor } from "../harness/wait-for.js";
import * as bt from "../assert/bt.js";
import { validateBytes } from "../assert/conformance.js";

// S18 (P-67, M-045): an order shipped in parts is invoiced per shipment — each invoice for what its
// fulfillment shipped, dated the day it shipped; the order's shipping on the first. Until P-67 each
// fulfillment invoiced the whole order again. A return from the second parcel is credited on the second
// invoice; a cancelled fulfillment's invoice is credited in full; and a refund naming no goods while part of
// the order is not shipped is refused for the merchant to decide — it may be money for goods never shipped.
describe("S18: an invoice per shipment", () => {
  let admin: AdminSession;
  let catalog: Catalog;

  beforeAll(async () => {
    admin = await adminLogin();
    catalog = await loadCatalog(admin);
  }, 60_000);

  async function checkout(email: string, extra: boolean, shirts = 1): Promise<string> {
    const { orderId } = await checkoutToOrder({
      publishableKey: catalog.publishableKey,
      regionId: catalog.regionId,
      salesChannelId: catalog.salesChannelId,
      variantId: requireVariantId(catalog, "SHIRT-S-BLACK"),
      quantity: shirts,
      ...(extra ? { extraItems: [{ variantId: requireVariantId(catalog, "SWEATSHIRT-M") }] } : {}),
      shippingOptionId: catalog.shippingOptionId,
      email,
      address: {
        firstName: "Max",
        lastName: "Mustermann",
        addressLine1: "Teststr. 18",
        city: "Leipzig",
        postalCode: "04109",
        countryCode: "de",
        company: "Mustermann GmbH",
      },
    });
    return orderId;
  }

  async function waitForDocuments(
    orderId: string,
    type: EinvoiceDocumentSummary["type"],
    count: number,
  ): Promise<readonly EinvoiceDocumentSummary[]> {
    let documents: readonly EinvoiceDocumentSummary[] = [];
    await waitFor(
      `${count} ${type}(s) for order ${orderId}`,
      async () => {
        documents = (await listEinvoiceDocuments(admin, orderId)).filter((d) => d.type === type);
        return documents.length >= count;
      },
      { timeoutMs: 30_000 },
    );
    // Oldest first: the listing is newest first.
    return [...documents].reverse();
  }

  async function xmlOf(orderId: string, document: EinvoiceDocumentSummary): Promise<string> {
    const bytes = await downloadEinvoiceFile(admin, orderId, document.id, "xml");
    const report = await validateBytes(bytes, `s18-${document.documentNumber}.xml`);
    expect(report.valid, JSON.stringify(report.messages)).toBe(true);
    expect(report.accepted, JSON.stringify(report.messages)).toBe(true);
    return bytes.toString("utf-8");
  }

  function berlinDate(iso: string): string {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" }).format(new Date(iso));
  }

  it("invoices two shipments separately, paid in full; credits a return on the invoice that holds it", async () => {
    const orderId = await checkout("s18-buyer@einvoice-e2e.example", true);
    const payment = await getOrderPayment(admin, orderId);
    // Paid in full before anything ships: every invoice states it (BT-113) and nothing is due.
    await capturePayment(admin, payment.id);
    const items = await getOrderItemValues(admin, orderId);
    const shirt = items.find(
      (item) => item.variantId === requireVariantId(catalog, "SHIRT-S-BLACK"),
    );
    const sweatshirt = items.find(
      (item) => item.variantId === requireVariantId(catalog, "SWEATSHIRT-M"),
    );
    if (shirt === undefined || sweatshirt === undefined) {
      throw new Error("the order is missing one of its two lines");
    }

    await fulfillItems(admin, orderId, catalog.stockLocationId, [{ id: shirt.id, quantity: 1 }]);
    const [first] = await waitForDocuments(orderId, "invoice", 1);
    await fulfillItems(admin, orderId, catalog.stockLocationId, [
      { id: sweatshirt.id, quantity: 1 },
    ]);
    const invoices = await waitForDocuments(orderId, "invoice", 2);
    const second = invoices[1];
    if (first === undefined || second === undefined) {
      throw new Error("unreachable: waitForDocuments guarantees two invoices");
    }
    expect(second.documentNumber).not.toBe(first.documentNumber);

    const [firstXml, secondXml] = [await xmlOf(orderId, first), await xmlOf(orderId, second)];
    const fulfillments = await listFulfillments(admin, orderId);
    // Each invoice holds its own shipment's line; the first carries the order's shipping.
    expect(bt.lineCount(firstXml)).toBe(1);
    expect(bt.lineCount(secondXml)).toBe(1);
    expect(bt.documentCharges(firstXml)).toHaveLength(1);
    expect(bt.documentCharges(secondXml)).toEqual([]);
    expect(bt.deliveryDate(firstXml)).toBe(berlinDate(fulfillments[0]?.createdAt ?? ""));
    expect(bt.deliveryDate(secondXml)).toBe(berlinDate(fulfillments[1]?.createdAt ?? ""));
    // Together they are the order — nothing invoiced twice.
    const order = await getOrder(admin, orderId);
    expect(bt.grandTotalAmount(firstXml) + bt.grandTotalAmount(secondXml)).toBeCloseTo(
      order.total,
      2,
    );
    for (const xml of [firstXml, secondXml]) {
      expect(bt.paidAmount(xml)).toBeCloseTo(bt.grandTotalAmount(xml), 2);
      expect(bt.duePayableAmount(xml)).toBe(0);
    }

    // The sweatshirt comes back, and its money: the credit note corrects the second invoice.
    await receiveReturn(admin, orderId, catalog.stockLocationId, [
      { itemId: sweatshirt.id, quantity: 1 },
    ]);
    await refundPayment(admin, payment.id, bt.grandTotalAmount(secondXml));
    const [creditNote] = await waitForDocuments(orderId, "credit_note", 1);
    if (creditNote === undefined) {
      throw new Error("unreachable: waitForDocuments guarantees a credit note");
    }
    const creditXml = await xmlOf(orderId, creditNote);
    expect(bt.correctedInvoiceNumber(creditXml)).toBe(second.documentNumber);
    expect(bt.grandTotalAmount(creditXml)).toBeCloseTo(bt.grandTotalAmount(secondXml), 2);
  });

  it("credits a cancelled fulfillment's invoice in full, and invoices the shipment that replaces it", async () => {
    const orderId = await checkout("s18-cancel@einvoice-e2e.example", false, 2);
    const [shirt] = await getOrderItemValues(admin, orderId);
    if (shirt === undefined) {
      throw new Error("the order has no line");
    }
    await fulfillItems(admin, orderId, catalog.stockLocationId, [{ id: shirt.id, quantity: 1 }]);
    await waitForDocuments(orderId, "invoice", 1);
    const secondFulfillment = await fulfillItems(admin, orderId, catalog.stockLocationId, [
      { id: shirt.id, quantity: 1 },
    ]);
    const [, second] = await waitForDocuments(orderId, "invoice", 2);
    if (second === undefined) {
      throw new Error("unreachable: waitForDocuments guarantees two invoices");
    }
    const secondXml = await xmlOf(orderId, second);

    await cancelFulfillment(admin, orderId, secondFulfillment);
    const [creditNote] = await waitForDocuments(orderId, "credit_note", 1);
    if (creditNote === undefined) {
      throw new Error("unreachable: waitForDocuments guarantees a credit note");
    }
    const creditXml = await xmlOf(orderId, creditNote);
    expect(bt.correctedInvoiceNumber(creditXml)).toBe(second.documentNumber);
    expect(bt.grandTotalAmount(creditXml)).toBeCloseTo(bt.grandTotalAmount(secondXml), 2);
    expect(bt.lineCount(creditXml)).toBe(1);

    // Money back with no goods while a unit is not shipped: it may be for that unit, which needs no credit
    // note, or goodwill on the first invoice — the merchant decides.
    const payment = await getOrderPayment(admin, orderId);
    await capturePayment(admin, payment.id);
    await refundPayment(admin, payment.id, 5);
    let refusal: EinvoiceRefusalSummary | undefined;
    await waitFor(
      `refusal for order ${orderId}`,
      async () => {
        refusal = (await getEinvoiceStatus(admin, orderId)).refusals.find(
          (r) => r.type === "credit_note",
        );
        return refusal !== undefined;
      },
      { timeoutMs: 30_000 },
    );
    expect(refusal?.code).toBe("REFUND_NEEDS_MANUAL_CREDIT");
    expect(await waitForDocuments(orderId, "credit_note", 1)).toHaveLength(1);

    // The unit ships again: a third invoice, for that shipment alone, without the shipping.
    await fulfillItems(admin, orderId, catalog.stockLocationId, [{ id: shirt.id, quantity: 1 }]);
    const invoices = await waitForDocuments(orderId, "invoice", 3);
    const third = invoices[2];
    if (third === undefined) {
      throw new Error("unreachable: waitForDocuments guarantees three invoices");
    }
    const thirdXml = await xmlOf(orderId, third);
    expect(bt.documentCharges(thirdXml)).toEqual([]);
    expect(bt.grandTotalAmount(thirdXml)).toBeCloseTo(bt.grandTotalAmount(secondXml), 2);
  });
});
