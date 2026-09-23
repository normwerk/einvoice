import { beforeAll, describe, expect, it } from "vitest";
import { adminLogin, type AdminSession } from "../api/admin.js";
import { checkoutToOrder } from "../api/checkout.js";
import { fulfillOrder, getOrderFulfillmentId, listEinvoiceDocuments } from "../api/orders.js";
import { capturePayment, getOrderPayment, refundPayment } from "../api/payments.js";
import { loadCatalog, requireVariantId, type Catalog } from "../seed/catalog.js";
import { redeliverEvent } from "../harness/exec-in-medusa.js";
import { waitFor } from "../harness/wait-for.js";

// plan-e2e.md §4: "повторная доставка того же события не создаёт второй документ" — proven against the
// real UNIQUE-index guard (`recordDocumentIfAbsent`, D-31) by actually delivering the event to the plugin's
// subscriber a second time and waiting for it to finish (`exec-in-medusa.ts`'s own doc comment on how).
describe("idempotency: redelivering an event does not create a second document", () => {
  let admin: AdminSession;
  let catalog: Catalog;

  beforeAll(async () => {
    admin = await adminLogin();
    catalog = await loadCatalog(admin);
  }, 60_000);

  async function checkoutFulfillAndWaitForInvoice(sku: string, email: string): Promise<string> {
    const { orderId } = await checkoutToOrder({
      publishableKey: catalog.publishableKey,
      regionId: catalog.regionId,
      salesChannelId: catalog.salesChannelId,
      variantId: requireVariantId(catalog, sku),
      shippingOptionId: catalog.shippingOptionId,
      email,
      address: {
        firstName: "Klaus",
        lastName: "Idempotent",
        addressLine1: "Teststr. 3",
        city: "Berlin",
        postalCode: "10115",
        countryCode: "de",
        company: "Musterfirma GmbH",
      },
    });

    await fulfillOrder(admin, orderId, catalog.stockLocationId);
    await waitFor(
      `invoice for order ${orderId}`,
      async () => (await listEinvoiceDocuments(admin, orderId)).some((d) => d.type === "invoice"),
      { timeoutMs: 30_000 },
    );
    return orderId;
  }

  it("redelivering order.fulfillment_created does not create a second invoice", async () => {
    const orderId = await checkoutFulfillAndWaitForInvoice(
      "SHORTS-M",
      "idempotency-buyer@einvoice-e2e.example",
    );
    const fulfillmentId = await getOrderFulfillmentId(admin, orderId);

    await redeliverEvent("invoice-on-fulfillment-created", "order.fulfillment_created", {
      order_id: orderId,
      fulfillment_id: fulfillmentId,
      no_notification: false,
    });

    const documents = await listEinvoiceDocuments(admin, orderId);
    expect(documents.filter((d) => d.type === "invoice")).toHaveLength(1);
  });

  it("redelivering payment.refunded does not create a second credit note", async () => {
    const orderId = await checkoutFulfillAndWaitForInvoice(
      "SHORTS-L",
      "idempotency-refund-buyer@einvoice-e2e.example",
    );

    const payment = await getOrderPayment(admin, orderId);
    await capturePayment(admin, payment.id);
    await refundPayment(admin, payment.id, payment.amount);

    await waitFor(
      `credit note for order ${orderId}`,
      async () =>
        (await listEinvoiceDocuments(admin, orderId)).some((d) => d.type === "credit_note"),
      { timeoutMs: 30_000 },
    );

    // The event payload only ever carries the *payment's* id (docs/domain-glossary.md's own finding) — the
    // subscriber re-reads `payment.refunds` itself and skips any refund it already credited, so redelivery
    // needs no separate refund id here.
    await redeliverEvent("credit-note-on-payment-refunded", "payment.refunded", { id: payment.id });

    const documents = await listEinvoiceDocuments(admin, orderId);
    expect(documents.filter((d) => d.type === "credit_note")).toHaveLength(1);
  });
});
