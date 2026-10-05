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
    const container = {
      resolve: () => ({ warn: vi.fn(), error: vi.fn() }),
    } as unknown as MedusaContainer;
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

describe("recordRefusalOfError logging (AGENTS.md §5.2)", () => {
  function logged() {
    const logger = { warn: vi.fn(), error: vi.fn() };
    const container = {
      resolve: (key: string) => (key === "event_bus" ? { emit: vi.fn() } : logger),
    } as unknown as MedusaContainer;
    return { logger, container };
  }
  const target = { type: "invoice", orderId: "order_01", idempotencyKey: "ful_01" } as const;

  it("logs an unexpected error at error level by its class, not by its message, which the refusal keeps", async () => {
    const { logger, container } = logged();
    const recordRefusal = vi.fn(async (input: unknown) => input);
    // Whatever the error's source put in it — a merchant's VIES client, say.
    const error = new TypeError(
      "VIES answered for FR98765432109: Exemple SARL, 1 Rue Exemple, Paris",
    );

    await recordRefusalOfError(
      container,
      { recordRefusal } as unknown as EinvoiceModuleService,
      target,
      error,
    );

    expect(logger.error).toHaveBeenCalledWith(
      "einvoice: order order_01: invoice for fulfillment ful_01 — not issued: an unexpected TypeError, " +
        "its message kept with the refusal [INTERNAL_ERROR]",
    );
    expect(logger.warn).not.toHaveBeenCalled();
    expect(recordRefusal).toHaveBeenCalledWith(
      expect.objectContaining({ details: expect.objectContaining({ message: error.message }) }),
    );
  });

  it("logs the refusal of an unverified VAT-ID without the VAT-ID — the message the core really raises", async () => {
    const { logger, container } = logged();
    const { decideVatCategory } = await import("@normwerk/einvoice-commerce");
    let error: unknown;
    try {
      decideVatCategory({
        sellerCountry: "DE",
        sellerVatId: "DE123456789",
        buyerCountry: "FR",
        buyerVatId: "FR98765432109",
        buyerIsBusiness: true,
        ossRegistered: false,
        supplyType: "goods",
      });
    } catch (thrown) {
      error = thrown;
    }

    await recordRefusalOfError(
      container,
      {
        recordRefusal: vi.fn(async () => ({ id: "einvref_1" })),
      } as unknown as EinvoiceModuleService,
      target,
      error,
    );

    const lines = logger.warn.mock.calls.map((call) => String(call[0])).join("\n");
    expect(lines).toContain("[VAT_ID_UNVERIFIED]");
    expect(lines).not.toContain("FR98765432109");
  });
});

describe("recordRefusalOfError events (P-71)", () => {
  it("announces the refusal with its id and code", async () => {
    const emit = vi.fn(async () => undefined);
    const container = {
      resolve: (key: string) => (key === "event_bus" ? { emit } : { warn: vi.fn() }),
    } as unknown as MedusaContainer;
    await recordRefusalOfError(
      container,
      {
        recordRefusal: vi.fn(async () => ({ id: "einvref_7", code: "VAT_ID_UNVERIFIED" })),
      } as unknown as EinvoiceModuleService,
      { type: "invoice", orderId: "order_01", idempotencyKey: "ful_01" },
      Object.assign(new Error("needs a positive VIES check"), {
        code: "VAT_ID_UNVERIFIED",
        docsUrl: "https://normwerk.dev/einvoice/docs/errors#vat-id-unverified",
      }),
    );
    expect(emit).toHaveBeenCalledWith({
      name: "einvoice.issuance_blocked",
      data: {
        schema_version: 1,
        refusal_id: "einvref_7",
        order_id: "order_01",
        type: "invoice",
        code: "VAT_ID_UNVERIFIED",
      },
    });
  });
});
