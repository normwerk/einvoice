import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminGetJson, adminLogin, adminPostJson, type AdminSession } from "../api/admin.js";
import { checkoutToOrder } from "../api/checkout.js";
import {
  fulfillOrder,
  getEinvoiceStatus,
  getOrderFulfillmentId,
  waitForDocumentXml,
  type EinvoiceRefusalSummary,
} from "../api/orders.js";
import { capturePayment, getOrderPayment, refundPayment } from "../api/payments.js";
import { createShippingOptionTaxRate, deleteTaxRate } from "../api/tax.js";
import { loadCatalog, requireVariantId, type Catalog } from "../seed/catalog.js";
import { waitFor } from "../harness/wait-for.js";

// S19 (P-71, M-047): the plugin's events as a shop's own subscriber receives them — the stand app records
// them (`e2e/app/src/subscribers/einvoice-events.ts`). `einvoice.document_issued` for an invoice and a credit
// note, `einvoice.issuance_blocked` for a blocked invoice: ids, number and codes only. The documents are read
// with the order through the plugin's read-only link, and a redelivered `order.fulfillment_created` — in the
// same process as that subscriber — announces nothing a second time.
interface RecordedEvent {
  readonly name: string;
  readonly data: Readonly<Record<string, unknown>>;
}

describe("S19: the plugin's events and the order link", () => {
  let admin: AdminSession;
  let catalog: Catalog;
  let taxRateId: string | undefined;

  beforeAll(async () => {
    admin = await adminLogin();
    catalog = await loadCatalog(admin);
  }, 60_000);

  afterAll(async () => {
    if (taxRateId !== undefined) {
      await deleteTaxRate(admin, taxRateId);
    }
  });

  async function eventsFor(orderId: string): Promise<readonly RecordedEvent[]> {
    const { events } = await adminGetJson<{ readonly events: readonly RecordedEvent[] }>(
      admin,
      "/admin/e2e/einvoice-events",
    );
    return events.filter((event) => event.data["order_id"] === orderId);
  }

  async function checkout(email: string): Promise<string> {
    const { orderId } = await checkoutToOrder({
      publishableKey: catalog.publishableKey,
      regionId: catalog.regionId,
      salesChannelId: catalog.salesChannelId,
      variantId: requireVariantId(catalog, "SHIRT-S-BLACK"),
      shippingOptionId: catalog.shippingOptionId,
      email,
      address: {
        firstName: "Erika",
        lastName: "Ereignis",
        addressLine1: "Teststr. 19",
        city: "Bremen",
        postalCode: "28195",
        countryCode: "de",
        company: "Ereignis GmbH",
      },
    });
    return orderId;
  }

  it("announces an issued invoice and credit note, readable through the order link, once", async () => {
    const orderId = await checkout("s19-buyer@einvoice-e2e.example");
    await fulfillOrder(admin, orderId, catalog.stockLocationId);
    const fulfillmentId = await getOrderFulfillmentId(admin, orderId);
    const { document: invoice } = await waitForDocumentXml(admin, orderId, "invoice");

    let issued: RecordedEvent | undefined;
    await waitFor(
      `document_issued for order ${orderId}`,
      async () => {
        issued = (await eventsFor(orderId)).find((e) => e.name === "einvoice.document_issued");
        return issued !== undefined;
      },
      { timeoutMs: 30_000 },
    );
    // Ids, number and what it is for — nothing of the buyer or the document's content.
    expect(issued?.data).toEqual({
      schema_version: 1,
      id: invoice.id,
      order_id: orderId,
      type: "invoice",
      document_number: invoice.documentNumber,
      fulfillment_id: fulfillmentId,
    });

    // The shop's code reads the document by the event's id, through the order.
    const { order } = await adminGetJson<{
      readonly order: { readonly einvoice_documents?: readonly Record<string, unknown>[] } | null;
    }>(admin, `/admin/e2e/orders/${orderId}/einvoice-documents`);
    const linked = order?.einvoice_documents?.find((d) => d["id"] === invoice.id);
    expect(linked).toMatchObject({
      id: invoice.id,
      type: "invoice",
      order_id: orderId,
      document_number: invoice.documentNumber,
    });
    expect(typeof linked?.["xml_file_id"]).toBe("string");

    // Delivered again in the same process: the invoice exists, nothing is announced.
    await adminPostJson(admin, "/admin/e2e/redeliver-fulfillment", {
      order_id: orderId,
      fulfillment_id: fulfillmentId,
    });
    expect(
      (await eventsFor(orderId)).filter((e) => e.name === "einvoice.document_issued"),
    ).toHaveLength(1);

    // A refund: its credit note is announced with the refund it credits.
    const payment = await getOrderPayment(admin, orderId);
    await capturePayment(admin, payment.id);
    await refundPayment(admin, payment.id, 5);
    let credit: RecordedEvent | undefined;
    await waitFor(
      `credit note event for order ${orderId}`,
      async () => {
        credit = (await eventsFor(orderId)).find(
          (e) => e.name === "einvoice.document_issued" && e.data["type"] === "credit_note",
        );
        return credit !== undefined;
      },
      { timeoutMs: 30_000 },
    );
    expect(credit?.data).toMatchObject({ schema_version: 1, order_id: orderId });
    expect(typeof credit?.data["refund_id"]).toBe("string");
  });

  it("announces an invoice it did not issue, with the refusal's id and code", async () => {
    // Shipping untaxed in Medusa, at 19 % on the invoice: blocked (the setup of S13).
    taxRateId = await createShippingOptionTaxRate(admin, "de", catalog.shippingOptionId, 0);
    const orderId = await checkout("s19-blocked@einvoice-e2e.example");
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
    await deleteTaxRate(admin, taxRateId);
    taxRateId = undefined;

    let blocked: RecordedEvent | undefined;
    await waitFor(
      `issuance_blocked for order ${orderId}`,
      async () => {
        blocked = (await eventsFor(orderId)).find((e) => e.name === "einvoice.issuance_blocked");
        return blocked !== undefined;
      },
      { timeoutMs: 30_000 },
    );
    expect(blocked?.data).toEqual({
      schema_version: 1,
      refusal_id: refusal?.id,
      order_id: orderId,
      type: "invoice",
      code: "INVOICE_VAT_ABOVE_CHARGED",
    });
  });
});
