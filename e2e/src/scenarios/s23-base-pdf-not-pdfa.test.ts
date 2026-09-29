import { beforeAll, describe, expect, it } from "vitest";
import { adminLogin, type AdminSession } from "../api/admin.js";
import { checkoutToOrder } from "../api/checkout.js";
import { fulfillOrder, getEinvoiceStatus, waitForDocumentXml } from "../api/orders.js";
import { loadCatalog, requireVariantId, type Catalog } from "../seed/catalog.js";
import { validateBytes } from "../assert/conformance.js";

// S23 (T-033): the shop's own PDF uses a font it does not embed (Helvetica, by name) — it cannot become PDF/A.
// The stand's basePdf renders such a PDF for this buyer. The invoice is issued as XML alone, the XML is valid,
// and the admin shows why there is no PDF, with its code.
describe("S23: a basePdf that cannot become PDF/A -> XML only, with a notice", () => {
  let admin: AdminSession;
  let catalog: Catalog;

  beforeAll(async () => {
    admin = await adminLogin();
    catalog = await loadCatalog(admin);
  }, 60_000);

  it("issues the invoice as XML and names the font it could not embed", async () => {
    const { orderId } = await checkoutToOrder({
      publishableKey: catalog.publishableKey,
      regionId: catalog.regionId,
      salesChannelId: catalog.salesChannelId,
      variantId: requireVariantId(catalog, "SHIRT-S-BLACK"),
      shippingOptionId: catalog.shippingOptionId,
      email: "s23-buyer@einvoice-e2e.example",
      address: {
        firstName: "Hans",
        lastName: "Helvetica",
        addressLine1: "Teststr. 23",
        city: "Mainz",
        postalCode: "55116",
        countryCode: "de",
        company: "Standardschrift GmbH",
      },
    });
    await fulfillOrder(admin, orderId, catalog.stockLocationId);
    const { xmlBytes } = await waitForDocumentXml(admin, orderId, "invoice");

    const [invoice] = (await getEinvoiceStatus(admin, orderId)).documents as unknown as readonly {
      readonly pdfUrl: string | null;
      readonly pdfNotice: {
        code: string;
        message: string;
        details: Record<string, unknown>;
      } | null;
    }[];
    expect(invoice?.pdfUrl).toBeNull();
    expect(invoice?.pdfNotice?.code).toBe("PDF_FONT_NOT_EMBEDDED");
    expect(invoice?.pdfNotice?.details).toMatchObject({ fontName: "Helvetica" });
    expect(invoice?.pdfNotice?.message).toMatch(/^Issued as XML only: /);
    const report = await validateBytes(xmlBytes, "s23-invoice.xml");
    expect(report.valid, JSON.stringify(report.messages)).toBe(true);
  });
});
