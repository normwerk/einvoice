import { describe, expect, it, vi } from "vitest";
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";

const mocks = vi.hoisted(() => ({
  issueInvoiceForFulfillment: vi.fn(),
  creditNoteOnPaymentRefunded: vi.fn(async () => undefined),
  creditNoteOnOrderCanceled: vi.fn(async () => undefined),
}));

vi.mock("../../../../../../../../invoices/issue-invoice.js", () => ({
  issueInvoiceForFulfillment: mocks.issueInvoiceForFulfillment,
}));
vi.mock("../../../../../../../../subscribers/credit-note-on-payment-refunded.js", () => ({
  default: mocks.creditNoteOnPaymentRefunded,
}));
vi.mock("../../../../../../../../subscribers/credit-note-on-order-canceled.js", () => ({
  default: mocks.creditNoteOnOrderCanceled,
}));

import { POST } from "./route.js";

const REFUSAL = {
  id: "einvref_1",
  type: "invoice",
  order_id: "order_01",
  idempotency_key: "ful_01",
  code: "INVOICE_VAT_ABOVE_CHARGED",
};

function call(
  refusals: readonly unknown[],
  after: { documents?: readonly unknown[]; refusals?: readonly unknown[] } = {},
): {
  req: MedusaRequest;
  res: MedusaResponse;
  sent: { status?: number; body?: unknown };
  service: {
    listEinvoiceRefusals: ReturnType<typeof vi.fn>;
    clearRefusal: ReturnType<typeof vi.fn>;
  };
} {
  let lookups = 0;
  const service = {
    // The first lookup finds the refusal to retry; a later one, what is left of it after the retry.
    listEinvoiceRefusals: vi.fn(async () => (lookups++ === 0 ? refusals : (after.refusals ?? []))),
    listEinvoiceDocuments: vi.fn(async () => after.documents ?? []),
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

  it("answers 500 with the message when issuing fails after the checks", async () => {
    mocks.issueInvoiceForFulfillment.mockRejectedValueOnce(new Error("file storage unavailable"));
    const { req, res, sent } = call([REFUSAL]);
    await POST(req, res);
    expect(sent).toEqual({ status: 500, body: { message: "file storage unavailable" } });
  });

  const CREDIT_REFUSAL = {
    id: "einvref_2",
    type: "credit_note",
    order_id: "order_01",
    idempotency_key: "refund_01",
    code: "MissingOriginalInvoiceError",
    details: { message: "no invoice", event: "payment.refunded", paymentId: "pay_01" },
  };

  it("retries a credit note by redelivering the refund's event, and reports the credit note it issued (P-66)", async () => {
    const { req, res, sent } = call([CREDIT_REFUSAL], {
      documents: [{ document_number: "GS-2026-0001" }],
    });
    await POST(req, res);
    expect(mocks.creditNoteOnPaymentRefunded).toHaveBeenCalledWith(
      expect.objectContaining({ event: { name: "payment.refunded", data: { id: "pay_01" } } }),
    );
    expect(sent).toEqual({
      status: 200,
      body: { outcome: "issued", documentNumber: "GS-2026-0001" },
    });
  });

  it("reports a credit note refused again with its new reason, and retries a cancellation by redelivering it (P-66)", async () => {
    const again = { ...CREDIT_REFUSAL, code: "TaxRuleError", details: { message: "VIES down" } };
    const refund = call([CREDIT_REFUSAL], { refusals: [again] });
    await POST(refund.req, refund.res);
    expect(refund.sent.body).toEqual({
      outcome: "blocked",
      code: "TaxRuleError",
      message: "Not issued: VIES down",
    });

    const cancellation = call([
      {
        ...CREDIT_REFUSAL,
        idempotency_key: "order.canceled:order_01",
        details: { event: "order.canceled" },
      },
    ]);
    await POST(cancellation.req, cancellation.res);
    expect(mocks.creditNoteOnOrderCanceled).toHaveBeenCalledWith(
      expect.objectContaining({ event: { name: "order.canceled", data: { id: "order_01" } } }),
    );
    // Neither a credit note nor a refusal: nothing is left to credit, and the refusal is dropped.
    expect(cancellation.sent.body).toEqual({ outcome: "none" });
    expect(cancellation.service.clearRefusal).toHaveBeenCalledWith(
      "credit_note",
      "order.canceled:order_01",
    );
  });
});
