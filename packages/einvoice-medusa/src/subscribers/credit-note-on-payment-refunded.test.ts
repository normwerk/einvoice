import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MedusaContainer, SubscriberArgs } from "@medusajs/framework";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { EINVOICE_MODULE } from "../modules/einvoice/index.js";
import type EinvoiceModuleService from "../modules/einvoice/service.js";

// Same isolation rationale as invoice-on-fulfillment-created.test.ts: this file unit-tests
// `creditNoteOnPaymentRefunded`'s own orchestration (the two-step payment→order resolution, the
// no-refunds/no-order/no-original-invoice guards, per-refund idempotency, and the same
// webbers/standalone/PDF-embed/lost-race logic invoice-on-fulfillment-created.ts has) — the business-rule
// engines it calls into (`@normwerk/einvoice-commerce`, `-cii`, `-pdfa`) already have their own exhaustive
// suites elsewhere.
const mocks = vi.hoisted(() => ({
  selectProfile: vi.fn(() => "EN16931" as const),
  buildInvoice: vi.fn((input: unknown) => ({ invoice: input, warnings: [] })),
  serializeCii: vi.fn(() => ({ xml: "<xml/>" })),
  embedInvoiceInPdfA3: vi.fn(async () => ({ pdfBytes: new Uint8Array([1, 2, 3]) })),
  waitForWebbersInvoice: vi.fn(),
  fetchWebbersPdfBytes: vi.fn(),
  storeEinvoiceFiles: vi.fn(async () => ({
    xmlFileId: "file_xml",
    pdfFileId: null as string | null,
  })),
  deleteEinvoiceFiles: vi.fn(async () => undefined),
  fetchFileBytes: vi.fn(async () => new TextEncoder().encode("<ignored/>")),
}));

vi.mock("@normwerk/einvoice-commerce", () => ({
  DE_STANDARD_RATE: "19",
  DE_REDUCED_RATE: "7",
  selectProfile: mocks.selectProfile,
  buildInvoice: mocks.buildInvoice,
  SequentialNumberer: class {
    next = vi.fn(async () => "GS-2026-0001");
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
    fetchFileBytes: mocks.fetchFileBytes,
  };
});

// A normal static import, not a dynamic one — see invoice-on-fulfillment-created.test.ts's identical note
// on why (vitest hoists every vi.mock above it regardless; a top-level `await import` would make this file
// a top-level-await ESM module, which this package's CommonJS compile target rejects at build time).
import creditNoteOnPaymentRefunded, {
  extractIssueDateFromCii,
  MissingOriginalInvoiceError,
} from "./credit-note-on-payment-refunded.js";

describe("extractIssueDateFromCii", () => {
  it("parses a real serializeCii-shaped IssueDateTime element (no pretty-print whitespace)", () => {
    const xml =
      "<rsm:ExchangedDocument><ram:TypeCode>380</ram:TypeCode><ram:IssueDateTime>" +
      '<udt:DateTimeString format="102">20260914</udt:DateTimeString>' +
      "</ram:IssueDateTime></rsm:ExchangedDocument>";
    expect(extractIssueDateFromCii(xml)).toBe("2026-09-14");
  });

  it("throws a clear error when no IssueDateTime element is present", () => {
    expect(() => extractIssueDateFromCii("<not-an-invoice/>")).toThrow(/no ram:IssueDateTime/);
  });
});

describe("MissingOriginalInvoiceError", () => {
  it("names the order id in its message", () => {
    const error = new MissingOriginalInvoiceError("order_01");
    expect(error.orderId).toBe("order_01");
    expect(error.message).toMatch(/order_01/);
    expect(error.name).toBe("MissingOriginalInvoiceError");
  });
});

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

const ORIGINAL_INVOICE = { document_number: "RE-2026-0001", xml_file_id: "file_original_xml" };

function makeEinvoiceService(
  overrides: Partial<{
    options: Record<string, unknown>;
    listEinvoiceDocuments: (filter: Record<string, unknown>) => Promise<readonly unknown[]>;
    recordDocumentIfAbsent: () => Promise<{ document: unknown; created: boolean }>;
  }> = {},
) {
  const listEinvoiceDocuments = vi.fn(
    overrides.listEinvoiceDocuments ??
      (async (filter: Record<string, unknown>) =>
        filter["type"] === "invoice" ? [ORIGINAL_INVOICE] : []),
  );
  return {
    options: { seller: SELLER, payment: PAYMENT, ...overrides.options },
    listEinvoiceDocuments,
    recordDocumentIfAbsent: vi.fn(
      overrides.recordDocumentIfAbsent ?? (async () => ({ document: {}, created: true })),
    ),
    allocateNextNumber: vi.fn(async () => 1),
  } as unknown as EinvoiceModuleService;
}

function makeContainer(options: {
  einvoiceService: EinvoiceModuleService;
  payment?: Record<string, unknown> | undefined;
  orders?: readonly unknown[];
}): { container: MedusaContainer; graph: ReturnType<typeof vi.fn> } {
  const payment = options.payment ?? {
    id: "pay_01",
    payment_collection_id: "paycol_01",
    refunds: [{ id: "refund_01" }],
  };
  const orders = options.orders ?? [ORDER];
  const graph = vi.fn(async ({ entity }: { entity: string }) => ({
    data: entity === "payment" ? [payment] : orders,
  }));
  const registry = new Map<unknown, unknown>([
    [EINVOICE_MODULE, options.einvoiceService],
    [ContainerRegistrationKeys.QUERY, { graph }],
  ]);
  const container = { resolve: (key: unknown) => registry.get(key) } as unknown as MedusaContainer;
  return { container, graph };
}

function makeArgs(
  container: MedusaContainer,
  data: { id: string },
): SubscriberArgs<{ id: string }> {
  return { event: { data }, container } as unknown as SubscriberArgs<{ id: string }>;
}

describe("creditNoteOnPaymentRefunded", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.selectProfile.mockReturnValue("EN16931");
    mocks.storeEinvoiceFiles.mockResolvedValue({ xmlFileId: "file_xml", pdfFileId: null });
    mocks.fetchFileBytes.mockResolvedValue(
      new TextEncoder().encode(
        "<ram:IssueDateTime><udt:DateTimeString>20260101</udt:DateTimeString></ram:IssueDateTime>",
      ),
    );
  });

  it("returns early when the payment has no payment_collection_id (gone, or never attached)", async () => {
    const einvoiceService = makeEinvoiceService();
    const { container } = makeContainer({
      einvoiceService,
      payment: { id: "pay_01", payment_collection_id: null, refunds: [{ id: "refund_01" }] },
    });

    await creditNoteOnPaymentRefunded(makeArgs(container, { id: "pay_01" }));

    expect(mocks.buildInvoice).not.toHaveBeenCalled();
  });

  it("returns early when the payment has no refunds yet", async () => {
    const einvoiceService = makeEinvoiceService();
    const { container } = makeContainer({
      einvoiceService,
      payment: { id: "pay_01", payment_collection_id: "paycol_01", refunds: [] },
    });

    await creditNoteOnPaymentRefunded(makeArgs(container, { id: "pay_01" }));

    expect(mocks.buildInvoice).not.toHaveBeenCalled();
  });

  it("returns early when no order links to the payment collection", async () => {
    const einvoiceService = makeEinvoiceService();
    const { container } = makeContainer({ einvoiceService, orders: [] });

    await creditNoteOnPaymentRefunded(makeArgs(container, { id: "pay_01" }));

    expect(mocks.buildInvoice).not.toHaveBeenCalled();
  });

  it("throws MissingOriginalInvoiceError when this plugin never generated an invoice for the order", async () => {
    const einvoiceService = makeEinvoiceService({
      listEinvoiceDocuments: async () => [],
    });
    const { container } = makeContainer({ einvoiceService });

    await expect(
      creditNoteOnPaymentRefunded(makeArgs(container, { id: "pay_01" })),
    ).rejects.toThrow(MissingOriginalInvoiceError);
  });

  it("skips a refund that already has a credit note (per-refund idempotency), still processing the rest", async () => {
    const einvoiceService = makeEinvoiceService({
      listEinvoiceDocuments: async (filter) => {
        if (filter["type"] === "invoice") return [ORIGINAL_INVOICE];
        // credit_note lookup: refund_01 already credited, refund_02 is not.
        return filter["idempotency_key"] === "refund_01" ? [{ id: "doc_existing" }] : [];
      },
    });
    const { container } = makeContainer({
      einvoiceService,
      payment: {
        id: "pay_01",
        payment_collection_id: "paycol_01",
        refunds: [{ id: "refund_01" }, { id: "refund_02" }],
      },
    });

    await creditNoteOnPaymentRefunded(makeArgs(container, { id: "pay_01" }));

    expect(mocks.buildInvoice).toHaveBeenCalledTimes(1);
    expect(einvoiceService.recordDocumentIfAbsent).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: "refund_02" }),
    );
  });

  it("builds a credit note referencing the original invoice's number and re-derived issue date", async () => {
    const einvoiceService = makeEinvoiceService();
    const { container } = makeContainer({ einvoiceService });

    await creditNoteOnPaymentRefunded(makeArgs(container, { id: "pay_01" }));

    expect(mocks.fetchFileBytes).toHaveBeenCalledWith(container, "file_original_xml");
    expect(mocks.buildInvoice).toHaveBeenCalledWith(
      expect.objectContaining({
        document: expect.objectContaining({
          number: "GS-2026-0001",
          correctedInvoice: { number: "RE-2026-0001", issueDate: "2026-01-01" },
        }),
      }),
      expect.anything(),
    );
    expect(einvoiceService.recordDocumentIfAbsent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "credit_note", documentNumber: "GS-2026-0001" }),
    );
  });

  it("cleans up the just-uploaded files when recordDocumentIfAbsent loses the concurrency race", async () => {
    mocks.storeEinvoiceFiles.mockResolvedValue({ xmlFileId: "file_xml", pdfFileId: "file_pdf" });
    const einvoiceService = makeEinvoiceService({
      recordDocumentIfAbsent: async () => ({ document: { id: "doc_existing" }, created: false }),
    });
    const { container } = makeContainer({ einvoiceService });

    await creditNoteOnPaymentRefunded(makeArgs(container, { id: "pay_01" }));

    expect(mocks.deleteEinvoiceFiles).toHaveBeenCalledWith(container, ["file_xml", "file_pdf"]);
  });
});
