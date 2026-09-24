import { describe, expect, it, vi } from "vitest";
import type { MedusaContainer } from "@medusajs/framework";
import type EinvoiceModuleService from "./modules/einvoice/service.js";
import { describeRefusal, recordRefusalOfError } from "./refusals.js";

describe("describeRefusal (P-66)", () => {
  it("explains a refusal by its error's message, and a block by its amounts", () => {
    expect(
      describeRefusal({
        code: "TaxRuleError",
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
    expect(describeRefusal({ code: "Error", details: {} })).toBe("Not issued [Error].");
  });
});

describe("recordRefusalOfError (P-66)", () => {
  it("records the error's class name as the code, its message, rule and trigger, and logs them", async () => {
    const recordRefusal = vi.fn(async () => ({ id: "einvref_1" }));
    const warn = vi.fn();
    const container = { resolve: () => ({ warn }) } as unknown as MedusaContainer;
    const error = Object.assign(new Error("needs a positive VIES check"), {
      name: "TaxRuleError",
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
      code: "TaxRuleError",
      details: {
        message: "needs a positive VIES check",
        ruleId: "tax-semantics#3",
        event: "payment.refunded",
        paymentId: "pay_01",
      },
    });
    expect(message).toBe("Not issued: needs a positive VIES check");
    expect(warn).toHaveBeenCalledWith(
      "einvoice: order order_01: credit note for refund_01 — Not issued: needs a positive VIES check [TaxRuleError]",
    );
  });
});
