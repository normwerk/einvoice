import { describe, expect, it, vi } from "vitest";
import type {
  AuthenticatedMedusaRequest,
  MedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http";

const mocks = vi.hoisted(() => ({
  fetchFileBytes: vi.fn(async () => new Uint8Array([1, 2, 3])),
}));

// Isolates this file's own logic (the 404 guards, content-type/filename selection, the ownership check)
// from `../storage.js`'s `fetchFileBytes` — a real File Module download, already covered by its own
// `storage.test.ts`.
vi.mock("../storage.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../storage.js")>();
  return { ...actual, fetchFileBytes: mocks.fetchFileBytes };
});

import {
  customerOwnsOrder,
  listAdminEinvoiceStatus,
  listEinvoiceDocumentSummaries,
  sendEinvoiceFile,
} from "./einvoice-http.js";

function makeRequest(einvoiceService: unknown): MedusaRequest {
  return { scope: { resolve: () => einvoiceService } } as unknown as MedusaRequest;
}

function makeResponse(): MedusaResponse & {
  readonly statusCode: { value: number | undefined };
  readonly jsonBody: { value: unknown };
  readonly headers: Record<string, string>;
  readonly sentBuffer: { value: Buffer | undefined };
} {
  const statusCode: { value: number | undefined } = { value: undefined };
  const jsonBody: { value: unknown } = { value: undefined };
  const headers: Record<string, string> = {};
  const sentBuffer: { value: Buffer | undefined } = { value: undefined };
  const res = {
    status: vi.fn((code: number) => {
      statusCode.value = code;
      return res;
    }),
    json: vi.fn((body: unknown) => {
      jsonBody.value = body;
      return res;
    }),
    setHeader: vi.fn((name: string, value: string) => {
      headers[name] = value;
      return res;
    }),
    send: vi.fn((buffer: Buffer) => {
      sentBuffer.value = buffer;
      return res;
    }),
    statusCode,
    jsonBody,
    headers,
    sentBuffer,
  };
  return res as unknown as MedusaResponse & typeof res;
}

describe("listEinvoiceDocumentSummaries", () => {
  it("maps each document to its download URLs under the given basePath, pdfUrl null when there's no PDF", async () => {
    const listEinvoiceDocuments = vi.fn(async () => [
      {
        id: "doc_1",
        type: "invoice" as const,
        document_number: "RE-2026-0001",
        pdf_file_id: "file_pdf",
      },
      {
        id: "doc_2",
        type: "credit_note" as const,
        document_number: "GS-2026-0001",
        pdf_file_id: null,
      },
    ]);
    const req = makeRequest({ listEinvoiceDocuments });

    const result = await listEinvoiceDocumentSummaries(req, "order_01", "/admin/orders/order_01");

    expect(listEinvoiceDocuments).toHaveBeenCalledWith(
      { order_id: "order_01" },
      { order: { created_at: "DESC" } },
    );
    expect(result).toEqual([
      {
        id: "doc_1",
        type: "invoice",
        documentNumber: "RE-2026-0001",
        xmlUrl: "/admin/orders/order_01/einvoice/doc_1/xml",
        pdfUrl: "/admin/orders/order_01/einvoice/doc_1/pdf",
      },
      {
        id: "doc_2",
        type: "credit_note",
        documentNumber: "GS-2026-0001",
        xmlUrl: "/admin/orders/order_01/einvoice/doc_2/xml",
        pdfUrl: null,
      },
    ]);
  });
});

describe("listAdminEinvoiceStatus (P-63)", () => {
  it("adds each document's notice and the refused documents with their retry route — admin only", async () => {
    const notice = {
      code: "VAT_OVERCHARGED",
      charged: "130.90",
      chargedVat: "20.90",
      invoiced: "110.00",
      invoicedVat: "0.00",
      priceBasis: "net",
      refundDue: "20.90",
    };
    const req = makeRequest({
      listEinvoiceDocuments: vi.fn(async () => [
        {
          id: "doc_1",
          type: "invoice" as const,
          document_number: "RE-2026-0001",
          pdf_file_id: null,
          notice,
        },
      ]),
      listEinvoiceRefusals: vi.fn(async () => [
        {
          id: "einvref_1",
          type: "invoice" as const,
          order_id: "order_01",
          idempotency_key: "ful_02",
          code: "INVOICE_VAT_ABOVE_CHARGED",
          details: {
            charged: "20.00",
            chargedVat: "0.00",
            invoiced: "23.80",
            invoicedVat: "3.80",
            priceBasis: "net",
          },
          updated_at: new Date("2026-01-15T10:00:00Z"),
        },
      ]),
    });

    const result = await listAdminEinvoiceStatus(req, "order_01");

    expect(result.documents[0]?.notice).toEqual({
      code: "VAT_OVERCHARGED",
      message: expect.stringContaining("overpaid 20.90"),
      details: notice,
    });
    expect(result.refusals).toEqual([
      {
        id: "einvref_1",
        type: "invoice",
        idempotencyKey: "ful_02",
        code: "INVOICE_VAT_ABOVE_CHARGED",
        message: expect.stringContaining("Not issued"),
        details: expect.objectContaining({ invoicedVat: "3.80" }),
        updatedAt: "2026-01-15T10:00:00.000Z",
        retryUrl: "/admin/orders/order_01/einvoice/refusals/einvref_1/retry",
      },
    ]);
  });

  it("keeps notices out of the store listing — they tell the merchant what to refund", async () => {
    const req = makeRequest({
      listEinvoiceDocuments: vi.fn(async () => [
        {
          id: "doc_1",
          type: "invoice" as const,
          document_number: "RE-2026-0001",
          pdf_file_id: null,
          notice: { code: "VAT_OVERCHARGED" },
        },
      ]),
    });
    const [document] = await listEinvoiceDocumentSummaries(
      req,
      "order_01",
      "/store/orders/order_01",
    );
    expect(document).not.toHaveProperty("notice");
  });
});

describe("sendEinvoiceFile", () => {
  it("responds 404 when no document matches (id, order) — never leaks whether the id exists at all", async () => {
    const listEinvoiceDocuments = vi.fn(async () => []);
    const req = makeRequest({ listEinvoiceDocuments });
    const res = makeResponse();

    await sendEinvoiceFile(req, res, {
      orderId: "order_01",
      documentId: "doc_missing",
      kind: "xml",
    });

    expect(listEinvoiceDocuments).toHaveBeenCalledWith({ id: "doc_missing", order_id: "order_01" });
    expect(res.statusCode.value).toBe(404);
    expect(res.send).not.toHaveBeenCalled();
  });

  it("responds 404 when the document has no file of the requested kind", async () => {
    const listEinvoiceDocuments = vi.fn(async () => [
      { id: "doc_1", document_number: "RE-2026-0001", xml_file_id: "file_xml", pdf_file_id: null },
    ]);
    const req = makeRequest({ listEinvoiceDocuments });
    const res = makeResponse();

    await sendEinvoiceFile(req, res, { orderId: "order_01", documentId: "doc_1", kind: "pdf" });

    expect(res.statusCode.value).toBe(404);
    expect(res.send).not.toHaveBeenCalled();
  });

  it("streams the XML file with the right content type and a filename-based Content-Disposition", async () => {
    const listEinvoiceDocuments = vi.fn(async () => [
      {
        id: "doc_1",
        document_number: "RE-2026-0001",
        xml_file_id: "file_xml",
        pdf_file_id: "file_pdf",
      },
    ]);
    const req = makeRequest({ listEinvoiceDocuments });
    const res = makeResponse();

    await sendEinvoiceFile(req, res, { orderId: "order_01", documentId: "doc_1", kind: "xml" });

    expect(mocks.fetchFileBytes).toHaveBeenCalledWith(req.scope, "file_xml");
    expect(res.headers["Content-Type"]).toBe("application/xml");
    expect(res.headers["Content-Disposition"]).toBe('attachment; filename="RE-2026-0001.xml"');
    expect(res.statusCode.value).toBe(200);
    expect(res.sentBuffer.value).toBeInstanceOf(Buffer);
  });

  it("streams the PDF file with the right content type when kind is pdf", async () => {
    const listEinvoiceDocuments = vi.fn(async () => [
      {
        id: "doc_1",
        document_number: "RE-2026-0001",
        xml_file_id: "file_xml",
        pdf_file_id: "file_pdf",
      },
    ]);
    const req = makeRequest({ listEinvoiceDocuments });
    const res = makeResponse();

    await sendEinvoiceFile(req, res, { orderId: "order_01", documentId: "doc_1", kind: "pdf" });

    expect(mocks.fetchFileBytes).toHaveBeenCalledWith(req.scope, "file_pdf");
    expect(res.headers["Content-Type"]).toBe("application/pdf");
    expect(res.headers["Content-Disposition"]).toBe('attachment; filename="RE-2026-0001.pdf"');
  });
});

describe("customerOwnsOrder", () => {
  function makeAuthedRequest(actorId: string, orderCustomerId: string | null | undefined) {
    const graph = vi.fn(async () => ({
      data: orderCustomerId === undefined ? [] : [{ customer_id: orderCustomerId }],
    }));
    return {
      scope: { resolve: () => ({ graph }) },
      auth_context: { actor_id: actorId },
    } as unknown as AuthenticatedMedusaRequest;
  }

  it("returns true when the authenticated customer is the order's own customer", async () => {
    const req = makeAuthedRequest("cus_01", "cus_01");
    await expect(customerOwnsOrder(req, "order_01")).resolves.toBe(true);
  });

  it("returns false when the authenticated customer is a different customer (IDOR guard)", async () => {
    const req = makeAuthedRequest("cus_02", "cus_01");
    await expect(customerOwnsOrder(req, "order_01")).resolves.toBe(false);
  });

  it("returns false when the order doesn't exist", async () => {
    const req = makeAuthedRequest("cus_01", undefined);
    await expect(customerOwnsOrder(req, "order_missing")).resolves.toBe(false);
  });
});
