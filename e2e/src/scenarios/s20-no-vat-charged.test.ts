import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminGetJson, adminLogin, type AdminSession } from "../api/admin.js";
import { checkoutToOrder } from "../api/checkout.js";
import {
  fulfillOrder,
  getEinvoiceStatus,
  getOrder,
  waitForDocumentXml,
  type EinvoiceRefusalSummary,
} from "../api/orders.js";
import { deleteTaxRegion, restoreGermanTaxRegion, setDefaultTaxRate } from "../api/tax.js";
import { loadCatalog, requireVariantId, type Catalog } from "../seed/catalog.js";
import { waitFor } from "../harness/wait-for.js";

// S20 (T-203, M-038): a German shop on which Medusa charged no VAT — its German tax region at 0 %, or no
// German tax region at all. That is a shop missing a rate, or a Kleinunternehmer (§19 UStG), who may always
// send an ordinary invoice instead (§34a Satz 4 UStDV) and whom the release does not serve. No invoice, no
// number taken — an ordinary order before and after gets consecutive numbers — and a refusal with its own
// code, visible in the admin and announced to the shop's code like any other.
describe("S20: a shop that charged no VAT -> NO_VAT_CHARGED, no number taken", () => {
  let admin: AdminSession;
  let catalog: Catalog;

  beforeAll(async () => {
    admin = await adminLogin();
    catalog = await loadCatalog(admin);
  }, 60_000);

  afterAll(async () => {
    // Every later scenario charges 19 %; put it back even when this one fails.
    await restoreGermanTaxRegion(admin);
  });

  async function checkout(email: string): Promise<string> {
    const { orderId } = await checkoutToOrder({
      publishableKey: catalog.publishableKey,
      regionId: catalog.regionId,
      salesChannelId: catalog.salesChannelId,
      variantId: requireVariantId(catalog, "SHIRT-S-BLACK"),
      shippingOptionId: catalog.shippingOptionId,
      email,
      address: {
        firstName: "Klara",
        lastName: "Klein",
        addressLine1: "Teststr. 20",
        city: "Kassel",
        postalCode: "34117",
        countryCode: "de",
        company: "Klein Handel",
      },
    });
    return orderId;
  }

  /** An ordinary order's invoice number, as a sequence number of the series. */
  async function nextInvoiceSequence(email: string): Promise<number> {
    const orderId = await checkout(email);
    await fulfillOrder(admin, orderId, catalog.stockLocationId);
    const { document } = await waitForDocumentXml(admin, orderId, "invoice");
    return Number(/(\d+)$/.exec(document.documentNumber)?.[1]);
  }

  async function expectRefusedWithoutVat(email: string): Promise<void> {
    const orderId = await checkout(email);
    const order = await getOrder(admin, orderId);
    expect(order.taxTotal).toBe(0);
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
    expect(refusal.code).toBe("NO_VAT_CHARGED");
    expect(refusal.message).toMatch(/^Not issued: /);
    expect(refusal.message).toContain("Kleinunternehmer (§19 UStG)");
    expect(refusal.message).toContain("§34a Satz 4 UStDV");
    expect(refusal.message).not.toMatch(/\bat \w+ \(|\b[TPMD]-\d{2,3}\b/);
    expect(refusal.docsUrl).toBe("https://normwerk.dev/einvoice/docs/errors#no-vat-charged");
    expect((await getEinvoiceStatus(admin, orderId)).documents).toEqual([]);

    const { events } = await adminGetJson<{
      readonly events: readonly { readonly name: string; readonly data: Record<string, unknown> }[];
    }>(admin, "/admin/e2e/einvoice-events");
    expect(
      events.find((e) => e.name === "einvoice.issuance_blocked" && e.data["order_id"] === orderId)
        ?.data,
    ).toMatchObject({ schema_version: 1, type: "invoice", code: "NO_VAT_CHARGED" });
  }

  it("refuses when Germany's tax region charges 0 %", async () => {
    const before = await nextInvoiceSequence("s20-before-zero@einvoice-e2e.example");
    await setDefaultTaxRate(admin, "de", 0);
    await expectRefusedWithoutVat("s20-zero-rate@einvoice-e2e.example");
    await restoreGermanTaxRegion(admin);
    expect(await nextInvoiceSequence("s20-after-zero@einvoice-e2e.example")).toBe(before + 1);
  });

  it("refuses when the shop has no tax region for Germany", async () => {
    const before = await nextInvoiceSequence("s20-before-none@einvoice-e2e.example");
    await deleteTaxRegion(admin, "de");
    await expectRefusedWithoutVat("s20-no-region@einvoice-e2e.example");
    await restoreGermanTaxRegion(admin);
    expect(await nextInvoiceSequence("s20-after-none@einvoice-e2e.example")).toBe(before + 1);
  });
});
