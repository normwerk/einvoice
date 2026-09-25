import { describe, expect, it, vi } from "vitest";
import type { MedusaContainer } from "@medusajs/framework";
import type EinvoiceModuleService from "./modules/einvoice/service.js";
import { describeRefusal, recordRefusalOfError } from "./refusals.js";

describe("describeRefusal (P-66)", () => {
  it("explains a refusal by its error's message, and a block by its amounts", () => {
    expect(
      describeRefusal({
        code: "VAT_ID_UNVERIFIED",
        details: { message: "needs a positive VIES check" },
      }),
    ).toBe("Not issued: needs a positive VIES check");
    expect(
      describeRefusal({
        code: "INVOICE_VAT_ABOVE_CHARGED",
        details: {
          charged: "20.00",
          chargedVat: "0.00",
          invoiced: "23.80",
          invoicedVat: "3.80",
          priceBasis: "net",
        },
      }),
    ).toContain("would state 3.80 VAT");
    expect(describeRefusal({ code: "INTERNAL_ERROR", details: {} })).toBe(
      "Not issued [INTERNAL_ERROR].",
    );
  });
});

describe("recordRefusalOfError (P-66)", () => {
  it("records the error's code, its message, class, rule and trigger, and logs them (T-077)", async () => {
    const recordRefusal = vi.fn(async () => ({ id: "einvref_1" }));
    const warn = vi.fn();
    const container = { resolve: () => ({ warn }) } as unknown as MedusaContainer;
    const error = Object.assign(new Error("needs a positive VIES check"), {
      name: "TaxRuleError",
      code: "VAT_ID_UNVERIFIED",
      docsUrl: "https://normwerk.dev/einvoice/docs/errors#vat-id-unverified",
      ruleId: "tax-semantics#3",
    });

    const { message } = await recordRefusalOfError(
      container,
      { recordRefusal } as unknown as EinvoiceModuleService,
      {
        type: "credit_note",
        orderId: "order_01",
        idempotencyKey: "refund_01",
        trigger: { event: "payment.refunded", paymentId: "pay_01" },
      },
      error,
    );

    expect(recordRefusal).toHaveBeenCalledWith({
      type: "credit_note",
      orderId: "order_01",
      idempotencyKey: "refund_01",
      code: "VAT_ID_UNVERIFIED",
      details: {
        message: "needs a positive VIES check",
        errorClass: "TaxRuleError",
        ruleId: "tax-semantics#3",
        event: "payment.refunded",
        paymentId: "pay_01",
      },
    });
    expect(message).toBe("Not issued: needs a positive VIES check");
    expect(warn).toHaveBeenCalledWith(
      "einvoice: order order_01: credit note for refund_01 — Not issued: needs a positive VIES check [VAT_ID_UNVERIFIED]",
    );
  });
});

describe("recordRefusalOfError codes (T-077)", () => {
  async function record(error: unknown) {
    const recordRefusal = vi.fn(async (input: unknown) => input);
    const container = { resolve: () => ({ warn: vi.fn() }) } as unknown as MedusaContainer;
    await recordRefusalOfError(
      container,
      { recordRefusal } as unknown as EinvoiceModuleService,
      { type: "invoice", orderId: "order_01", idempotencyKey: "ful_01" },
      error,
    );
    return recordRefusal.mock.calls[0]?.[0] as {
      readonly code: string;
      readonly details: Record<string, unknown>;
    };
  }

  it("keeps an unsupported buyer country with the refusal, for the support request", async () => {
    const error = Object.assign(new Error("buyer country IT runs a clearance platform"), {
      code: "UNSUPPORTED_BUYER_COUNTRY_CLEARANCE",
      docsUrl: "https://normwerk.dev/einvoice/docs/errors#unsupported-buyer-country-clearance",
      countryCode: "IT",
    });
    const { code, details } = await record(error);
    expect(code).toBe("UNSUPPORTED_BUYER_COUNTRY_CLEARANCE");
    expect(details["country"]).toBe("IT");
  });

  it("records an error without a code as INTERNAL_ERROR, with its message", async () => {
    const { code, details } = await record(new Error("connection reset"));
    expect(code).toBe("INTERNAL_ERROR");
    expect(details).toMatchObject({ message: "connection reset", errorClass: "Error" });
  });
});
