import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MedusaContainer, SubscriberArgs } from "@medusajs/framework";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { EINVOICE_MODULE } from "../modules/einvoice/index.js";
import type EinvoiceModuleService from "../modules/einvoice/service.js";
import { WebbersInvoiceNotFoundError } from "../integrations/webbers.js";

// This file unit-tests `invoiceOnFulfillmentCreated`'s own orchestration (idempotency, the
// order-not-found guard, webbers-vs-standalone branching, the PDF-embed conditional, and the
// concurrency-race cleanup) — not the business-rule engines it calls into. `@normwerk/einvoice-commerce`,
// `@normwerk/einvoice-cii`, and `@normwerk/einvoice-pdfa` already have their own exhaustive test suites
// (build-invoice.test.ts, index.test.ts, render-invoice.test.ts); re-validating EN 16931 business rules
// here would just duplicate that coverage while making this file fragile to unrelated changes there.
// `../integrations/webbers.js` is mocked for the same reason `webbers.test.ts` itself can only exercise
// the "not installed" path directly: `@webbers/invoices-medusa` is a deliberately-uninstalled optional
// peer in this repo (T-072's own doc comment), so its success path is unreachable without mocking.
const mocks = vi.hoisted(() => ({
  selectProfile: vi.fn(() => "EN16931" as const),
  buildInvoice: vi.fn((input: unknown) => ({
    invoice: input,
    warnings: [],
  })),
  serializeCii: vi.fn(() => ({ xml: "<xml/>" })),
  embedInvoiceInPdfA3: vi.fn(async () => ({ pdfBytes: new Uint8Array([1, 2, 3]) })),
  waitForWebbersInvoice: vi.fn(),
  fetchWebbersPdfBytes: vi.fn(),
  storeEinvoiceFiles: vi.fn(async () => ({
    xmlFileId: "file_xml",
    pdfFileId: null as string | null,
  })),
  deleteEinvoiceFiles: vi.fn(async () => undefined),
}));

vi.mock("@normwerk/einvoice-commerce", () => ({
  DE_STANDARD_RATE: "19",
  DE_REDUCED_RATE: "7",
  selectProfile: mocks.selectProfile,
  buildInvoice: mocks.buildInvoice,
  SequentialNumberer: class {
    next = vi.fn(async () => "RE-2026-0001");
  },
}));

vi.mock("@normwerk/einvoice-cii", () => ({
  serializeCii: mocks.serializeCii,
}));

vi.mock("@normwerk/einvoice-pdfa", () => ({
  embedInvoiceInPdfA3: mocks.embedInvoiceInPdfA3,
}));

vi.mock("../integrations/webbers.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../integrations/webbers.js")>();
  return {
    ...actual,
    waitForWebbersInvoice: mocks.waitForWebbersInvoice,
    fetchWebbersPdfBytes: mocks.fetchWebbersPdfBytes,
  };
});

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
      title: "Widget",
      variant_sku: "WID-1",
      unit_price: 100,
      is_tax_inclusive: false,
      tax_lines: [{ rate: 19 }],
      detail: { quantity: 2 },
    },
  ],
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
      overrides.recordDocumentIfAbsent ?? (async () => ({ document: {}, created: true })),
    ),
    allocateNextNumber: vi.fn(async () => 1),
  } as unknown as EinvoiceModuleService;
}

function makeContainer(
  einvoiceService: EinvoiceModuleService,
  orders: readonly unknown[] = [ORDER],
): { container: MedusaContainer; graph: ReturnType<typeof vi.fn> } {
  const graph = vi.fn(async () => ({ data: orders }));
  const registry = new Map<unknown, unknown>([
    [EINVOICE_MODULE, einvoiceService],
    [ContainerRegistrationKeys.QUERY, { graph }],
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

    expect(mocks.buildInvoice).toHaveBeenCalledTimes(1);
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

  it("webbers mode: reuses their display_id as the document number and their PDF, without allocating one", async () => {
    mocks.waitForWebbersInvoice.mockResolvedValue({
      invoice: { display_id: 4242, pdf_url: "https://webbers.example.test/inv.pdf" },
    });
    mocks.fetchWebbersPdfBytes.mockResolvedValue(new Uint8Array([7, 7, 7]));
    const einvoiceService = makeEinvoiceService({
      options: {
        seller: SELLER,
        payment: PAYMENT,
        integration: { kind: "webbers", waitForInvoiceMs: 1000, pollIntervalMs: 10 },
      },
    });
    const { container } = makeContainer(einvoiceService);

    await invoiceOnFulfillmentCreated(
      makeArgs(container, { order_id: "order_01", fulfillment_id: "ful_01" }),
    );

    expect(mocks.waitForWebbersInvoice).toHaveBeenCalledTimes(1);
    expect(mocks.fetchWebbersPdfBytes).toHaveBeenCalledWith(
      container,
      "https://webbers.example.test/inv.pdf",
    );
    expect(mocks.embedInvoiceInPdfA3).toHaveBeenCalledTimes(1);
    expect(einvoiceService.recordDocumentIfAbsent).toHaveBeenCalledWith(
      expect.objectContaining({ documentNumber: "4242" }),
    );
  });

  it("webbers mode: throws WebbersInvoiceNotFoundError when no invoice ever appears", async () => {
    mocks.waitForWebbersInvoice.mockResolvedValue(undefined);
    const einvoiceService = makeEinvoiceService({
      options: {
        seller: SELLER,
        payment: PAYMENT,
        integration: { kind: "webbers", waitForInvoiceMs: 1000, pollIntervalMs: 10 },
      },
    });
    const { container } = makeContainer(einvoiceService);

    await expect(
      invoiceOnFulfillmentCreated(
        makeArgs(container, { order_id: "order_01", fulfillment_id: "ful_01" }),
      ),
    ).rejects.toThrow(WebbersInvoiceNotFoundError);
    expect(einvoiceService.recordDocumentIfAbsent).not.toHaveBeenCalled();
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
});
