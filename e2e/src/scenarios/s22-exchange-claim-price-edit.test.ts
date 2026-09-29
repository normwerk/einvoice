import { beforeAll, describe, expect, it } from "vitest";
import { adminGetJson, adminLogin, type AdminSession } from "../api/admin.js";
import { checkoutToOrder } from "../api/checkout.js";
import { fulfillItems } from "../api/fulfillments.js";
import {
  fulfillOrder,
  getEinvoiceStatus,
  getOrder,
  waitForDocumentXml,
  type EinvoiceRefusalSummary,
} from "../api/orders.js";
import { capturePayment, getOrderPayment, refundPayment } from "../api/payments.js";
import { claimReplacement, editUnitPrice, exchangeItem } from "../api/rma.js";
import { loadCatalog, requireVariantId, type Catalog } from "../seed/catalog.js";
import { waitFor } from "../harness/wait-for.js";

// S22 (T-201): what the plugin does not document, refused or noted in the admin instead of documented wrongly.
// An exchange (S → L): the new item's shipment gets no invoice, and a refund on the order no credit note. A
// warranty claim with a replacement: the replacement's shipment gets no invoice. A price lowered by an order
// edit after the invoice: a notice on that invoice. Every refusal is announced like any other.
describe("S22: exchange, warranty replacement and a price edited after the invoice", () => {
  let admin: AdminSession;
  let catalog: Catalog;

  beforeAll(async () => {
    admin = await adminLogin();
    catalog = await loadCatalog(admin);
  }, 60_000);

  async function invoicedOrder(email: string): Promise<{ orderId: string; itemId: string }> {
    const { orderId } = await checkoutToOrder({
      publishableKey: catalog.publishableKey,
      regionId: catalog.regionId,
      salesChannelId: catalog.salesChannelId,
      variantId: requireVariantId(catalog, "SHIRT-S-BLACK"),
      shippingOptionId: catalog.shippingOptionId,
      email,
      address: {
        firstName: "Ernst",
        lastName: "Ersatz",
        addressLine1: "Teststr. 22",
        city: "Dresden",
        postalCode: "01067",
        countryCode: "de",
        company: "Ersatz GmbH",
      },
    });
    await fulfillOrder(admin, orderId, catalog.stockLocationId);
    await waitForDocumentXml(admin, orderId, "invoice");
    const itemId = (await getOrder(admin, orderId)).itemIds[0];
    if (itemId === undefined) throw new Error(`order ${orderId} has no line`);
    return { orderId, itemId };
  }

  async function refusalFor(
    orderId: string,
    type: EinvoiceRefusalSummary["type"],
  ): Promise<EinvoiceRefusalSummary> {
    let refusal: EinvoiceRefusalSummary | undefined;
    await waitFor(
      `${type} refusal for order ${orderId}`,
      async () => {
        refusal = (await getEinvoiceStatus(admin, orderId)).refusals.find((r) => r.type === type);
        return refusal !== undefined;
      },
      { timeoutMs: 30_000 },
    );
    if (refusal === undefined) throw new Error("unreachable: waitFor guarantees a refusal");
    return refusal;
  }

  async function blockedEvent(orderId: string, code: string): Promise<unknown> {
    const { events } = await adminGetJson<{
      readonly events: readonly { readonly name: string; readonly data: Record<string, unknown> }[];
    }>(admin, "/admin/e2e/einvoice-events");
    return events.find(
      (e) =>
        e.name === "einvoice.issuance_blocked" &&
        e.data["order_id"] === orderId &&
        e.data["code"] === code,
    );
  }

  it("refuses the exchange's shipment and a refund on the order, and says what to do", async () => {
    const { orderId, itemId } = await invoicedOrder("s22-exchange@einvoice-e2e.example");
    // Captured before the exchange: confirming it cancels a payment still only authorized.
    const payment = await getOrderPayment(admin, orderId);
    await capturePayment(admin, payment.id);
    const newItemId = await exchangeItem(
      admin,
      orderId,
      itemId,
      requireVariantId(catalog, "SHIRT-L-BLACK"),
      catalog.shippingOptionId,
    );
    await fulfillItems(admin, orderId, catalog.stockLocationId, [{ id: newItemId, quantity: 1 }]);

    const refusal = await refusalFor(orderId, "invoice");
    expect(refusal.code).toBe("SHIPMENT_OF_EXCHANGE");
    expect(refusal.message).toMatch(/^Not issued: .*exchange.*outside the plugin/);
    expect(refusal.docsUrl).toBe("https://normwerk.dev/einvoice/docs/errors#shipment-of-exchange");
    expect((await getEinvoiceStatus(admin, orderId)).documents.map((d) => d.type)).toEqual([
      "invoice",
    ]);
    expect(await blockedEvent(orderId, "SHIPMENT_OF_EXCHANGE")).toBeDefined();

    await refundPayment(admin, payment.id, 5);
    expect((await refusalFor(orderId, "credit_note")).code).toBe("REFUND_ON_EXCHANGE");
    expect((await getEinvoiceStatus(admin, orderId)).documents.map((d) => d.type)).toEqual([
      "invoice",
    ]);
  });

  it("refuses the shipment of a warranty replacement", async () => {
    const { orderId, itemId } = await invoicedOrder("s22-claim@einvoice-e2e.example");
    const replacementId = await claimReplacement(
      admin,
      orderId,
      itemId,
      requireVariantId(catalog, "SHIRT-S-BLACK"),
      catalog.shippingOptionId,
    );
    await fulfillItems(admin, orderId, catalog.stockLocationId, [
      { id: replacementId, quantity: 1 },
    ]);

    const refusal = await refusalFor(orderId, "invoice");
    expect(refusal.code).toBe("SHIPMENT_OF_CLAIM_REPLACEMENT");
    expect(refusal.message).toContain("§14c Abs. 1 UStG");
    expect((await getEinvoiceStatus(admin, orderId)).documents.map((d) => d.type)).toEqual([
      "invoice",
    ]);
    expect(await blockedEvent(orderId, "SHIPMENT_OF_CLAIM_REPLACEMENT")).toBeDefined();
  });

  it("notes a price lowered by an order edit on the invoice it was issued at", async () => {
    const { orderId, itemId } = await invoicedOrder("s22-edit@einvoice-e2e.example");
    const { items } = await getOrder(admin, orderId);
    const quantity = items.find((item) => item.id === itemId)?.quantity ?? 1;
    await editUnitPrice(admin, orderId, itemId, quantity, 5);

    let notices: readonly { code: string; message: string; details: Record<string, unknown> }[] =
      [];
    await waitFor(
      `price notice for order ${orderId}`,
      async () => {
        const invoice = (await getEinvoiceStatus(admin, orderId)).documents[0] as
          { readonly priceNotices?: typeof notices } | undefined;
        notices = invoice?.priceNotices ?? [];
        return notices.length > 0;
      },
      { timeoutMs: 30_000 },
    );
    expect(notices).toHaveLength(1);
    expect(notices[0]?.code).toBe("PRICE_CHANGED_AFTER_INVOICE");
    expect(notices[0]?.details).toMatchObject({
      itemId,
      newUnitPrice: "5.00",
      direction: "lowered",
    });
    expect(notices[0]?.message).toContain("Refunding the difference issues a credit note");
  });
});
