import { describe, expect, it, vi } from "vitest";
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";

const mocks = vi.hoisted(() => ({ issueInvoiceForFulfillment: vi.fn() }));

vi.mock("../../../../../../../../invoices/issue-invoice.js", () => ({
  issueInvoiceForFulfillment: mocks.issueInvoiceForFulfillment,
}));

import { POST } from "./route.js";

const REFUSAL = {
  id: "einvref_1",
  type: "invoice",
  order_id: "order_01",
  idempotency_key: "ful_01",
  code: "INVOICE_VAT_ABOVE_CHARGED",
};

function call(refusals: readonly unknown[]): {
  req: MedusaRequest;
  res: MedusaResponse;
  sent: { status?: number; body?: unknown };
  service: {
    listEinvoiceRefusals: ReturnType<typeof vi.fn>;
    clearRefusal: ReturnType<typeof vi.fn>;
  };
} {
  const service = {
    listEinvoiceRefusals: vi.fn(async () => refusals),
    clearRefusal: vi.fn(async () => undefined),
  };
  const sent: { status?: number; body?: unknown } = {};
  const res = {
    status: (code: number) => {
      sent.status = code;
      return res;
    },
    json: (body: unknown) => {
      sent.body = body;
      return res;
    },
  };
  const req = {
    params: { id: "order_01", refusalId: "einvref_1" },
    scope: { resolve: () => service },
  };
  return {
    req: req as unknown as MedusaRequest,
    res: res as unknown as MedusaResponse,
    sent,
    service,
  };
}

describe("POST /admin/orders/:id/einvoice/refusals/:refusalId/retry (P-63)", () => {
  it("answers 404 for a refusal that is not this order's", async () => {
    const { req, res, sent, service } = call([]);
    await POST(req, res);
    expect(service.listEinvoiceRefusals).toHaveBeenCalledWith({
      id: "einvref_1",
      order_id: "order_01",
    });
    expect(sent.status).toBe(404);
    expect(mocks.issueInvoiceForFulfillment).not.toHaveBeenCalled();
  });

  it("issues the invoice for the refused fulfillment, checks included", async () => {
    mocks.issueInvoiceForFulfillment.mockResolvedValueOnce({
      kind: "issued",
      documentNumber: "RE-2026-0002",
      notice: null,
    });
    const { req, res, sent } = call([REFUSAL]);
    await POST(req, res);
    expect(mocks.issueInvoiceForFulfillment).toHaveBeenCalledWith(req.scope, {
      orderId: "order_01",
      fulfillmentId: "ful_01",
    });
    expect(sent).toEqual({
      status: 200,
      body: { outcome: "issued", documentNumber: "RE-2026-0002", noticeCode: null },
    });
  });

  it("says why when the retry is still blocked", async () => {
    mocks.issueInvoiceForFulfillment.mockResolvedValueOnce({
      kind: "blocked",
      refusal: REFUSAL,
      message: "Not issued: …",
    });
    const { req, res, sent } = call([REFUSAL]);
    await POST(req, res);
    expect(sent).toEqual({
      status: 200,
      body: { outcome: "blocked", code: "INVOICE_VAT_ABOVE_CHARGED", message: "Not issued: …" },
    });
  });

  it("answers 422 with the reason when the invoice is refused for another reason", async () => {
    mocks.issueInvoiceForFulfillment.mockRejectedValueOnce(new Error("category K needs a VAT-ID"));
    const { req, res, sent } = call([REFUSAL]);
    await POST(req, res);
    expect(sent).toEqual({ status: 422, body: { message: "category K needs a VAT-ID" } });
  });
});
