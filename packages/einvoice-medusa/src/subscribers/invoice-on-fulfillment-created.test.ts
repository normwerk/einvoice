import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MedusaContainer, SubscriberArgs } from "@medusajs/framework";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import { EINVOICE_MODULE } from "../modules/einvoice/index.js";
import type EinvoiceModuleService from "../modules/einvoice/service.js";
import type { MedusaFulfillment, MedusaOrderChange } from "../mapping/shipment.js";

// This file unit-tests `invoiceOnFulfillmentCreated`'s own orchestration (idempotency, the
// order-not-found guard, the PDF-embed conditional, and the
// concurrency-race cleanup) — not the business-rule engines it calls into. `@normwerk/einvoice-commerce`,
// `@normwerk/einvoice-cii`, and `@normwerk/einvoice-pdfa` already have their own exhaustive test suites
// (build-invoice.test.ts, index.test.ts, render-invoice.test.ts); re-validating EN 16931 business rules
// here would just duplicate that coverage while making this file fragile to unrelated changes there.
const mocks = vi.hoisted(() => ({
  selectProfile: vi.fn(() => "EN16931" as const),
  // Shaped like a real BuildResult where the subscriber reads it (`invoice.totals`: what ORDER below
  // charged, so the P-63 check passes), otherwise the input passed straight through, which is what the
  // orchestration assertions below compare against.
  buildInvoice: vi.fn((input: unknown) => ({
    invoice: {
      ...(input as object),
      totals: { totalAmountWithVat: "238.00", totalVatAmount: "38.00" },
      lines: [],
    },
    warnings: [],
    decisions: [],
  })),
  serializeCii: vi.fn(() => ({ xml: "<xml/>" })),
  embedInvoiceInPdfA3: vi.fn(async () => ({ pdfBytes: new Uint8Array([1, 2, 3]) })),
  storeEinvoiceFiles: vi.fn(async () => ({
    xmlFileId: "file_xml",
    pdfFileId: null as string | null,
  })),
  deleteEinvoiceFiles: vi.fn(async () => undefined),
  logger: { warn: vi.fn(), info: vi.fn() },
  eventBus: { emit: vi.fn(async () => undefined) },
  nextNumber: vi.fn(async () => "RE-2026-0001"),
}));

vi.mock("@normwerk/einvoice-commerce", () => ({
  DE_STANDARD_RATE: "19",
  DE_REDUCED_RATE: "7",
  selectProfile: mocks.selectProfile,
  buildInvoice: mocks.buildInvoice,
  SequentialNumberer: class {
    next = mocks.nextNumber;
  },
}));

vi.mock("@normwerk/einvoice-cii", () => ({
  serializeCii: mocks.serializeCii,
}));

vi.mock("@normwerk/einvoice-pdfa", () => ({
  embedInvoiceInPdfA3: mocks.embedInvoiceInPdfA3,
}));

vi.mock("../storage.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../storage.js")>();
  return {
    ...actual,
    storeEinvoiceFiles: mocks.storeEinvoiceFiles,
    deleteEinvoiceFiles: mocks.deleteEinvoiceFiles,
  };
});

// A normal static import, not a dynamic one — vitest hoists every `vi.mock(...)` call above all imports
// in this file (including this one) regardless, and a dynamic `await import(...)` here would make this
// file a top-level-await ESM module, which this package's own CommonJS compile target (tsconfig.json)
// rejects at build time.
import invoiceOnFulfillmentCreated from "./invoice-on-fulfillment-created.js";

const SELLER = {
  name: "Musterfirma GmbH",
  countryCode: "DE" as const,
  addressLine1: "Musterstraße 1",
  city: "Berlin",
  postCode: "10115",
  vatIdentifier: "DE123456789",
};
const PAYMENT = { means: "58" as const, iban: "DE89370400440532013000" };

const ORDER = {
  id: "order_01",
  display_id: 1,
  email: "buyer@example.test",
  currency_code: "eur",
  customer: { company_name: "Buyer GmbH", email: "buyer@example.test" },
  billing_address: {
    country_code: "de",
    city: "Munich",
    postal_code: "80331",
    address_1: "Beispielstraße 1",
    company: "Buyer GmbH",
  },
  shipping_address: null,
  items: [
    {
      id: "item_01",
      title: "Widget",
      variant_sku: "WID-1",
      unit_price: 100,
      is_tax_inclusive: false,
      tax_lines: [{ rate: 19 }],
      detail: { quantity: 2 },
      total: 238,
      tax_total: 38,
    },
  ],
  // P-67: the fulfillment the invoice is for, shipping the whole order.
  fulfillments: [
    {
      id: "ful_01",
      created_at: "2026-01-15T09:00:00Z",
      items: [{ line_item_id: "item_01", quantity: 2 }],
    },
  ],
  total: 238,
  tax_total: 38,
};

function makeEinvoiceService(
  overrides: Partial<{
    options: Record<string, unknown>;
    listEinvoiceDocuments: () => Promise<readonly unknown[]>;
    recordDocumentIfAbsent: () => Promise<{ document: unknown; created: boolean }>;
  }> = {},
) {
  return {
    options: { seller: SELLER, payment: PAYMENT, ...overrides.options },
    listEinvoiceDocuments: vi.fn(overrides.listEinvoiceDocuments ?? (async () => [])),
    recordDocumentIfAbsent: vi.fn(
      overrides.recordDocumentIfAbsent ??
        (async () => ({ document: { id: "einvdoc_01" }, created: true })),
    ),
    allocateNextNumber: vi.fn(async () => 1),
    recordRefusal: vi.fn(async (input: { code: string }) => ({
      id: "einvref_1",
      code: input.code,
    })),
    clearRefusal: vi.fn(async () => undefined),
  } as unknown as EinvoiceModuleService;
}

/** T-202: the order's record of each fulfillment (`order_change`) — every line's units as it lists them. */
function fulfillmentRecords(orders: readonly unknown[]): readonly MedusaOrderChange[] {
  return (orders as readonly { fulfillments?: readonly MedusaFulfillment[] | null }[]).flatMap(
    (order) =>
      (order.fulfillments ?? []).map((fulfillment) => ({
        actions: (fulfillment.items ?? []).map((item) => ({
          action: "FULFILL_ITEM",
          reference_id: fulfillment.id,
          details: { reference_id: item.line_item_id, quantity: item.quantity },
        })),
      })),
  );
}

function makeContainer(
  einvoiceService: EinvoiceModuleService,
  orders: readonly unknown[] = [ORDER],
): { container: MedusaContainer; graph: ReturnType<typeof vi.fn> } {
  const graph = vi.fn(async ({ entity }: { entity: string }) => ({
    data: entity === "order_change" ? fulfillmentRecords(orders) : orders,
  }));
  const registry = new Map<unknown, unknown>([
    [EINVOICE_MODULE, einvoiceService],
    [ContainerRegistrationKeys.QUERY, { graph }],
    [ContainerRegistrationKeys.LOGGER, mocks.logger],
    [Modules.EVENT_BUS, mocks.eventBus],
  ]);
  const container = { resolve: (key: unknown) => registry.get(key) } as unknown as MedusaContainer;
  return { container, graph };
}

function makeArgs(
  container: MedusaContainer,
  data: { order_id: string; fulfillment_id: string },
): SubscriberArgs<{ order_id: string; fulfillment_id: string }> {
  return { event: { data }, container } as unknown as SubscriberArgs<{
    order_id: string;
    fulfillment_id: string;
  }>;
}

/** The `document.number` a `buildInvoice` call was given. */
function numberOf(input: unknown): unknown {
  return (input as { document: { number?: string } }).document.number;
}

describe("invoiceOnFulfillmentCreated", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.selectProfile.mockReturnValue("EN16931");
    mocks.storeEinvoiceFiles.mockResolvedValue({ xmlFileId: "file_xml", pdfFileId: null });
  });

  it("returns early, doing no further work, when a document already exists for this fulfillment (idempotency)", async () => {
    const einvoiceService = makeEinvoiceService({
      listEinvoiceDocuments: async () => [{ id: "doc_1" }],
    });
    const { container, graph } = makeContainer(einvoiceService);

    await invoiceOnFulfillmentCreated(
      makeArgs(container, { order_id: "order_01", fulfillment_id: "ful_01" }),
    );

    expect(einvoiceService.listEinvoiceDocuments).toHaveBeenCalledWith({
      type: "invoice",
      idempotency_key: "ful_01",
    });
    expect(graph).not.toHaveBeenCalled();
    expect(mocks.buildInvoice).not.toHaveBeenCalled();
    expect(einvoiceService.recordDocumentIfAbsent).not.toHaveBeenCalled();
    // P-71: a redelivered event finds its document issued and announces nothing.
    expect(mocks.eventBus.emit).not.toHaveBeenCalled();
  });

  it("keeps the VIES answer an intra-EU invoice rests on, and the rule it followed, with the document (T-192)", async () => {
    const evidence = {
      vatId: "FR98765432109",
      status: "valid" as const,
      checkedAt: "2026-01-15",
      consultationNumber: "WAPIAAAAW1",
    };
    const decision = { ruleId: "tax-semantics#3", categoryCode: "K", reasoning: "VIES", scope: {} };
    const verify = vi.fn(async () => evidence);
    // buildInvoice hands back the evidence it was given, as the real one does — for the check build and the
    // real one.
    const build = ((input: unknown, options: { vatIdEvidence?: unknown }) => ({
      invoice: {
        ...(input as object),
        totals: { totalAmountWithVat: "238.00", totalVatAmount: "38.00" },
        lines: [],
      },
      warnings: [],
      decisions: [decision],
      vatIdEvidence: options.vatIdEvidence,
    })) as never;
    mocks.buildInvoice.mockImplementationOnce(build).mockImplementationOnce(build);
    const einvoiceService = makeEinvoiceService({ options: { vatIdVerifier: { verify } } });
    const order = {
      ...ORDER,
      customer: { ...ORDER.customer, metadata: { vat_id: "FR98765432109" } },
    };
    const { container } = makeContainer(einvoiceService, [order]);

    await invoiceOnFulfillmentCreated(
      makeArgs(container, { order_id: "order_01", fulfillment_id: "ful_01" }),
    );

    expect(verify).toHaveBeenCalledWith("FR98765432109", expect.any(Date));
    expect(einvoiceService.recordDocumentIfAbsent).toHaveBeenCalledWith(
      expect.objectContaining({ vatIdEvidence: evidence, taxDecisions: [decision] }),
    );
    // The event carries none of it (P-71: ids, number and codes only).
    expect(JSON.stringify(mocks.eventBus.emit.mock.calls)).not.toContain("FR98765432109");
  });

  it("announces the issued invoice to the shop's own subscribers, ids and number only (P-71)", async () => {
    const einvoiceService = makeEinvoiceService();
    const { container } = makeContainer(einvoiceService);
    await invoiceOnFulfillmentCreated(
      makeArgs(container, { order_id: "order_01", fulfillment_id: "ful_01" }),
    );
    expect(mocks.eventBus.emit).toHaveBeenCalledWith({
      name: "einvoice.document_issued",
      data: {
        schema_version: 1,
        id: "einvdoc_01",
        order_id: "order_01",
        type: "invoice",
        document_number: "RE-2026-0001",
        fulfillment_id: "ful_01",
      },
    });
  });

  it("returns early when the order no longer exists by the time the subscriber runs", async () => {
    const einvoiceService = makeEinvoiceService();
    const { container } = makeContainer(einvoiceService, []);

    await invoiceOnFulfillmentCreated(
      makeArgs(container, { order_id: "order_gone", fulfillment_id: "ful_01" }),
    );

    expect(mocks.buildInvoice).not.toHaveBeenCalled();
    expect(einvoiceService.recordDocumentIfAbsent).not.toHaveBeenCalled();
  });

  it("standalone mode with no basePdf: allocates a number, serializes XML, and uploads XML only", async () => {
    const einvoiceService = makeEinvoiceService();
    const { container } = makeContainer(einvoiceService);

    await invoiceOnFulfillmentCreated(
      makeArgs(container, { order_id: "order_01", fulfillment_id: "ful_01" }),
    );

    // A check build before the number is taken (P-48), then the real one with the number.
    expect(mocks.buildInvoice).toHaveBeenCalledTimes(2);
    expect(mocks.buildInvoice.mock.calls.map((call) => numberOf(call[0]))).toEqual([
      "UNALLOCATED",
      "RE-2026-0001",
    ]);
    expect(mocks.serializeCii).toHaveBeenCalledTimes(1);
    expect(mocks.embedInvoiceInPdfA3).not.toHaveBeenCalled();
    expect(mocks.storeEinvoiceFiles).toHaveBeenCalledWith(
      container,
      expect.objectContaining({
        filenamePrefix: "RE-2026-0001",
        xml: "<xml/>",
        pdfBytes: undefined,
      }),
    );
    expect(einvoiceService.recordDocumentIfAbsent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "invoice",
        orderId: "order_01",
        idempotencyKey: "ful_01",
        documentNumber: "RE-2026-0001",
      }),
    );
  });

  it("standalone mode with a basePdf: embeds the XML as PDF/A-3 and uploads both files", async () => {
    const basePdfBytes = new Uint8Array([9, 9, 9]);
    const basePdf = vi.fn(async () => basePdfBytes);
    const einvoiceService = makeEinvoiceService({
      options: { seller: SELLER, payment: PAYMENT, standalone: { basePdf } },
    });
    const { container } = makeContainer(einvoiceService);
    mocks.storeEinvoiceFiles.mockResolvedValue({ xmlFileId: "file_xml", pdfFileId: "file_pdf" });

    await invoiceOnFulfillmentCreated(
      makeArgs(container, { order_id: "order_01", fulfillment_id: "ful_01" }),
    );

    expect(basePdf).toHaveBeenCalledTimes(1);
    expect(mocks.embedInvoiceInPdfA3).toHaveBeenCalledWith(
      basePdfBytes,
      "<xml/>",
      expect.objectContaining({ profile: "EN16931", title: "RE-2026-0001" }),
    );
    expect(mocks.storeEinvoiceFiles).toHaveBeenCalledWith(
      container,
      expect.objectContaining({ pdfBytes: new Uint8Array([1, 2, 3]) }),
    );
  });

  it("cleans up the just-uploaded files when recordDocumentIfAbsent loses the concurrency race", async () => {
    mocks.storeEinvoiceFiles.mockResolvedValue({ xmlFileId: "file_xml", pdfFileId: "file_pdf" });
    const einvoiceService = makeEinvoiceService({
      recordDocumentIfAbsent: async () => ({ document: { id: "doc_existing" }, created: false }),
    });
    const { container } = makeContainer(einvoiceService);

    await invoiceOnFulfillmentCreated(
      makeArgs(container, { order_id: "order_01", fulfillment_id: "ful_01" }),
    );

    expect(mocks.deleteEinvoiceFiles).toHaveBeenCalledWith(container, ["file_xml", "file_pdf"]);
  });
  it("records an order buildInvoice refuses, with its reason, and takes no document number (P-48, P-66)", async () => {
    mocks.buildInvoice.mockImplementationOnce(() => {
      throw Object.assign(new Error("needs a positive VIES check"), {
        name: "TaxRuleError",
        code: "VAT_ID_UNVERIFIED",
        docsUrl: "https://normwerk.dev/einvoice/docs/errors#vat-id-unverified",
        ruleId: "tax-semantics#3",
      });
    });
    const einvoiceService = makeEinvoiceService();
    const { container } = makeContainer(einvoiceService);

    await invoiceOnFulfillmentCreated(
      makeArgs(container, { order_id: "order_01", fulfillment_id: "ful_01" }),
    );

    expect(einvoiceService.recordRefusal).toHaveBeenCalledWith({
      type: "invoice",
      orderId: "order_01",
      idempotencyKey: "ful_01",
      code: "VAT_ID_UNVERIFIED",
      details: {
        message: "needs a positive VIES check",
        errorClass: "TaxRuleError",
        ruleId: "tax-semantics#3",
      },
    });
    expect(mocks.nextNumber).not.toHaveBeenCalled();
    expect(mocks.storeEinvoiceFiles).not.toHaveBeenCalled();
    const logged = mocks.logger.warn.mock.calls.map((call) => String(call[0])).join("\n");
    expect(logged).toContain("Not issued: needs a positive VIES check [VAT_ID_UNVERIFIED]");
  });

  it("reports buildInvoice's warnings without the invoice payload (P-39)", async () => {
    const built = {
      invoice: { totals: { totalAmountWithVat: "238.00", totalVatAmount: "38.00" }, lines: [] },
      warnings: [{ code: "payment-terms-not-mapped", message: "terms dropped" }],
      decisions: [],
    } as never;
    mocks.buildInvoice.mockReturnValueOnce(built).mockReturnValueOnce(built);
    const einvoiceService = makeEinvoiceService();
    const { container } = makeContainer(einvoiceService);

    await invoiceOnFulfillmentCreated(
      makeArgs(container, { order_id: "order_01", fulfillment_id: "ful_01" }),
    );

    const logged = mocks.logger.warn.mock.calls.map((call) => String(call[0]));
    expect(logged.some((line) => line.includes("payment-terms-not-mapped"))).toBe(true);
    expect(logged.join("\n")).not.toContain("buyer@example.test");
    expect(einvoiceService.clearRefusal).toHaveBeenCalledWith("invoice", "ful_01");
  });

  it("does not issue an invoice stating more VAT than Medusa charged: records why, takes no number, stores nothing (P-63)", async () => {
    const einvoiceService = makeEinvoiceService();
    // Medusa charged 200.00 without VAT; the invoice would say 238.00 with 38.00 VAT. P-69: compared with
    // what Medusa charged for the fulfillment's lines.
    const charged = { ...ORDER.items[0], total: 200, tax_total: 0 };
    const { container } = makeContainer(einvoiceService, [
      { ...ORDER, items: [charged], total: 200, tax_total: 0 },
    ]);

    await invoiceOnFulfillmentCreated(
      makeArgs(container, { order_id: "order_01", fulfillment_id: "ful_01" }),
    );

    expect(einvoiceService.recordRefusal).toHaveBeenCalledWith({
      type: "invoice",
      orderId: "order_01",
      idempotencyKey: "ful_01",
      code: "INVOICE_VAT_ABOVE_CHARGED",
      details: expect.objectContaining({
        charged: "200.00",
        chargedVat: "0.00",
        invoiced: "238.00",
      }),
    });
    expect(mocks.buildInvoice).toHaveBeenCalledTimes(1);
    expect(mocks.nextNumber).not.toHaveBeenCalled();
    expect(mocks.storeEinvoiceFiles).not.toHaveBeenCalled();
    expect(einvoiceService.recordDocumentIfAbsent).not.toHaveBeenCalled();
    const logged = mocks.logger.warn.mock.calls.map((call) => String(call[0])).join("\n");
    expect(logged).toContain("INVOICE_VAT_ABOVE_CHARGED");
    expect(logged).not.toContain("buyer@example.test");
    // P-71: the block is announced with its refusal's id and code.
    expect(mocks.eventBus.emit).toHaveBeenCalledWith({
      name: "einvoice.issuance_blocked",
      data: {
        schema_version: 1,
        refusal_id: "einvref_1",
        order_id: "order_01",
        type: "invoice",
        code: "INVOICE_VAT_ABOVE_CHARGED",
      },
    });
  });

  it("states the invoice as paid when the order was paid in full before it shipped (P-67)", async () => {
    const einvoiceService = makeEinvoiceService();
    const { container } = makeContainer(einvoiceService, [
      { ...ORDER, payment_collections: [{ captured_amount: 238, refunded_amount: 0 }] },
    ]);
    await invoiceOnFulfillmentCreated(
      makeArgs(container, { order_id: "order_01", fulfillment_id: "ful_01" }),
    );
    // The check build states no payment; the real one states the whole total as paid (BT-113).
    const calls = mocks.buildInvoice.mock.calls as unknown as [{ paidAmount?: string }][];
    expect(calls.map(([input]) => input.paidAmount)).toEqual([undefined, "238.00"]);
  });

  it("invoices nothing for a fulfillment cancelled before its invoice was issued (P-67)", async () => {
    const einvoiceService = makeEinvoiceService();
    const canceled = { ...ORDER.fulfillments[0], canceled_at: "2026-01-16T09:00:00Z" };
    const { container } = makeContainer(einvoiceService, [{ ...ORDER, fulfillments: [canceled] }]);
    await invoiceOnFulfillmentCreated(
      makeArgs(container, { order_id: "order_01", fulfillment_id: "ful_01" }),
    );
    expect(mocks.buildInvoice).not.toHaveBeenCalled();
    expect(einvoiceService.clearRefusal).toHaveBeenCalledWith("invoice", "ful_01");
  });

  it("records a fulfillment the order does not have as a refusal (P-67)", async () => {
    const einvoiceService = makeEinvoiceService();
    const { container } = makeContainer(einvoiceService);
    await invoiceOnFulfillmentCreated(
      makeArgs(container, { order_id: "order_01", fulfillment_id: "ful_99" }),
    );
    expect(einvoiceService.recordRefusal).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: "ful_99", code: "FULFILLMENT_MISSING" }),
    );
    expect(mocks.buildInvoice).not.toHaveBeenCalled();
  });

  it("issues an invoice stating less VAT than Medusa charged, with a notice of what the buyer overpaid (P-63)", async () => {
    const built = {
      invoice: { totals: { totalAmountWithVat: "200.00", totalVatAmount: "0.00" }, lines: [] },
      warnings: [],
      decisions: [],
    } as never;
    mocks.buildInvoice.mockReturnValueOnce(built).mockReturnValueOnce(built);
    const einvoiceService = makeEinvoiceService();
    const { container } = makeContainer(einvoiceService);

    await invoiceOnFulfillmentCreated(
      makeArgs(container, { order_id: "order_01", fulfillment_id: "ful_01" }),
    );

    expect(einvoiceService.recordDocumentIfAbsent).toHaveBeenCalledWith(
      expect.objectContaining({
        documentNumber: "RE-2026-0001",
        notice: expect.objectContaining({ code: "VAT_OVERCHARGED", refundDue: "38.00" }),
      }),
    );
    expect(einvoiceService.recordRefusal).not.toHaveBeenCalled();
    const logged = mocks.logger.warn.mock.calls.map((call) => String(call[0])).join("\n");
    expect(logged).toContain("VAT_OVERCHARGED");
  });
});
