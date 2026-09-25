import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MedusaContainer, SubscriberArgs } from "@medusajs/framework";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { EINVOICE_MODULE } from "../modules/einvoice/index.js";
import type EinvoiceModuleService from "../modules/einvoice/service.js";

// Same isolation rationale as invoice-on-fulfillment-created.test.ts: this file unit-tests
// `creditNoteOnPaymentRefunded`'s own orchestration (the two-step payment→order resolution, the
// no-refunds/no-order/no-original-invoice guards, per-refund idempotency, and the same
// PDF-embed/lost-race logic invoice-on-fulfillment-created.ts has) — the business-rule
// engines it calls into (`@normwerk/einvoice-commerce`, `-cii`, `-pdfa`) already have their own exhaustive
// suites elsewhere.
const mocks = vi.hoisted(() => ({
  selectProfile: vi.fn(() => "EN16931" as const),
  // Shaped like a real BuildResult where the code reads it (`invoice.totals`).
  buildInvoice: vi.fn((input: unknown) => ({
    invoice: { ...(input as object), totals: { totalAmountWithVat: "20.00" } },
    warnings: [],
  })),
  decideVatCategory: vi.fn(() => ({ categoryCode: "S", ruleId: "tax-semantics#1" })),
  nextNumber: vi.fn(async () => "GS-2026-0001"),
  logger: { warn: vi.fn(), info: vi.fn() },
  serializeCii: vi.fn(() => ({ xml: "<xml/>" })),
  embedInvoiceInPdfA3: vi.fn(async () => ({ pdfBytes: new Uint8Array([1, 2, 3]) })),
  storeEinvoiceFiles: vi.fn(async () => ({
    xmlFileId: "file_xml",
    pdfFileId: null as string | null,
  })),
  deleteEinvoiceFiles: vi.fn(async () => undefined),
  fetchFileBytes: vi.fn<(container: unknown, fileId: unknown) => Promise<Uint8Array>>(async () =>
    new TextEncoder().encode("<ignored/>"),
  ),
}));

vi.mock("@normwerk/einvoice-commerce", async (importOriginal) => ({
  // The real, pure allocation across rates (P-65); everything that builds a document is mocked.
  allocateCreditAcrossRates: (await importOriginal<{ allocateCreditAcrossRates: unknown }>())
    .allocateCreditAcrossRates,
  DE_STANDARD_RATE: "19",
  DE_REDUCED_RATE: "7",
  selectProfile: mocks.selectProfile,
  buildInvoice: mocks.buildInvoice,
  decideVatCategory: mocks.decideVatCategory,
  // The rate a line resolves to — here simply the rate it was charged at.
  resolveLineRate: (_d: unknown, _c: unknown, kind: unknown, charged: unknown) => charged ?? kind,
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
// The original invoice: 2 × 100 net at 19% = 238.00 (BT-112), issued 2026-01-01 (BT-2).
let CREDITED_TOTAL = "0.00";
/** A CII document's BG-23 breakdown, as this plugin's serializer writes it — gross per rate. */
function breakdown(byRate: Readonly<Record<string, string>>): string {
  return Object.entries(byRate)
    .map(
      ([rate, gross]) =>
        `<ram:ApplicableTradeTax><ram:CalculatedAmount>0.00</ram:CalculatedAmount><ram:TypeCode>VAT</ram:TypeCode>` +
        `<ram:BasisAmount>${gross}</ram:BasisAmount><ram:CategoryCode>S</ram:CategoryCode>` +
        `<ram:RateApplicablePercent>${rate}</ram:RateApplicablePercent></ram:ApplicableTradeTax>`,
    )
    .join("");
}

function cii(
  grandTotal: string,
  byRate: Readonly<Record<string, string>> = { "19": grandTotal },
): string {
  return (
    "<ram:IssueDateTime><udt:DateTimeString>20260101</udt:DateTimeString></ram:IssueDateTime>" +
    breakdown(byRate) +
    `<ram:GrandTotalAmount>${grandTotal}</ram:GrandTotalAmount>`
  );
}

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
    clearRefusal: vi.fn(async () => undefined),
    recordRefusal: vi.fn(async (input: { code: string }) => ({
      id: "einvref_1",
      code: input.code,
    })),
  } as unknown as EinvoiceModuleService;
}

function makeContainer(options: {
  einvoiceService: EinvoiceModuleService;
  payment?: Record<string, unknown> | undefined;
  orders?: readonly unknown[];
  returns?: readonly unknown[];
}): { container: MedusaContainer; graph: ReturnType<typeof vi.fn> } {
  const payment = options.payment ?? {
    id: "pay_01",
    payment_collection_id: "paycol_01",
    refunds: [{ id: "refund_01", amount: 238 }],
  };
  const orders = options.orders ?? [ORDER];
  const first = orders[0] as { readonly id?: string } | undefined;
  const collection = { id: "paycol_01", order: first === undefined ? null : { id: first.id } };
  const graph = vi.fn(async ({ entity }: { entity: string }) => ({
    data:
      entity === "payment"
        ? [payment]
        : entity === "payment_collection"
          ? [collection]
          : entity === "return"
            ? (options.returns ?? [])
            : orders,
  }));
  const registry = new Map<unknown, unknown>([
    [EINVOICE_MODULE, options.einvoiceService],
    [ContainerRegistrationKeys.QUERY, { graph }],
    [ContainerRegistrationKeys.LOGGER, mocks.logger],
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
    mocks.fetchFileBytes.mockImplementation(async (_container: unknown, fileId: unknown) =>
      new TextEncoder().encode(cii(fileId === "file_credit_xml" ? CREDITED_TOTAL : "238.00")),
    );
  });

  it("returns early when the payment has no payment_collection_id (gone, or never attached)", async () => {
    const einvoiceService = makeEinvoiceService();
    const { container } = makeContainer({
      einvoiceService,
      payment: {
        id: "pay_01",
        payment_collection_id: null,
        refunds: [{ id: "refund_01", amount: 238 }],
      },
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

  it("records MissingOriginalInvoiceError as a refusal to retry when this plugin never generated an invoice for the order (P-66)", async () => {
    const einvoiceService = makeEinvoiceService({
      listEinvoiceDocuments: async () => [],
    });
    const { container } = makeContainer({ einvoiceService });

    await creditNoteOnPaymentRefunded(makeArgs(container, { id: "pay_01" }));

    expect(einvoiceService.recordRefusal).toHaveBeenCalledWith({
      type: "credit_note",
      orderId: "order_01",
      idempotencyKey: "refund_01",
      code: "MissingOriginalInvoiceError",
      details: expect.objectContaining({ event: "payment.refunded", paymentId: "pay_01" }),
    });
    expect(mocks.buildInvoice).not.toHaveBeenCalled();
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
        refunds: [
          { id: "refund_01", amount: 238 },
          { id: "refund_02", amount: 238 },
        ],
      },
    });

    await creditNoteOnPaymentRefunded(makeArgs(container, { id: "pay_01" }));

    // One credit note: its check build before the number is taken (P-48), then the real one.
    expect(mocks.buildInvoice).toHaveBeenCalledTimes(2);
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

  it("credits a partial refund with one line over its own amount, not the whole order (P-41)", async () => {
    const einvoiceService = makeEinvoiceService();
    const { container } = makeContainer({
      einvoiceService,
      payment: {
        id: "pay_01",
        payment_collection_id: "paycol_01",
        refunds: [{ id: "refund_01", amount: 20 }],
      },
    });

    await creditNoteOnPaymentRefunded(makeArgs(container, { id: "pay_01" }));

    const [input] = mocks.buildInvoice.mock.calls[0] as unknown as [
      { lines: readonly { priceInclVat: string; itemName: string }[]; shipping?: unknown },
    ];
    expect(input.lines).toHaveLength(1);
    // The refunded gross sum, VAT-inclusive: buildInvoice takes the VAT out, so the credit note totals it.
    expect(input.lines[0]?.priceInclVat).toBe("20.00");
    expect(input.lines[0]?.itemName).toContain("RE-2026-0001");
    expect(input.shipping).toBeUndefined();
  });

  it("never credits more than is outstanding: a refund after the invoice is fully credited is logged, not credited", async () => {
    CREDITED_TOTAL = "238.00";
    const einvoiceService = makeEinvoiceService({
      listEinvoiceDocuments: async (filter) => {
        if (filter["type"] === "invoice") return [ORIGINAL_INVOICE];
        if (filter["order_id"] === "order_01") {
          return [{ id: "doc_cancel", xml_file_id: "file_credit_xml" }];
        }
        return [];
      },
    });
    const { container } = makeContainer({ einvoiceService });

    await creditNoteOnPaymentRefunded(makeArgs(container, { id: "pay_01" }));

    expect(mocks.buildInvoice).not.toHaveBeenCalled();
    expect(mocks.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("already fully credited"),
    );
    CREDITED_TOTAL = "0.00";
  });

  it("credits a partial refund over mixed VAT rates with a line per rate, in proportion to the invoice (P-65)", async () => {
    // The invoice: 238.00 at 19% and 10.70 at 7%.
    mocks.fetchFileBytes.mockImplementation(async () =>
      new TextEncoder().encode(cii("248.70", { "19": "238.00", "7": "10.70" })),
    );
    const einvoiceService = makeEinvoiceService();
    const { container } = makeContainer({
      einvoiceService,
      payment: {
        id: "pay_01",
        payment_collection_id: "paycol_01",
        refunds: [{ id: "refund_01", amount: 20 }],
      },
      orders: [
        {
          ...ORDER,
          items: [
            ...ORDER.items,
            {
              title: "Book",
              unit_price: 10,
              is_tax_inclusive: false,
              tax_lines: [{ rate: 7 }],
              detail: { quantity: 1 },
            },
          ],
        },
      ],
    });

    await creditNoteOnPaymentRefunded(makeArgs(container, { id: "pay_01" }));

    const creditNote = mocks.buildInvoice.mock.calls.at(-1)?.[0] as {
      readonly lines: readonly { readonly priceInclVat?: string; readonly itemName: string }[];
    };
    // 20.00 over 238.00 : 10.70 — 19.14 at 19%, 0.86 at 7%.
    expect(creditNote.lines.map((line) => [line.priceInclVat, line.itemName])).toEqual([
      ["19.14", "Teilerstattung / Partial refund (anteilig 19 %) — Rechnung RE-2026-0001"],
      ["0.86", "Teilerstattung / Partial refund (anteilig 7 %) — Rechnung RE-2026-0001"],
    ]);
    expect(einvoiceService.recordDocumentIfAbsent).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: "refund_01", coveredReturns: null }),
    );
  });

  it("pays for a received return first, at its line's rate, and records which return it covered (P-65)", async () => {
    mocks.fetchFileBytes.mockImplementation(async () =>
      new TextEncoder().encode(cii("248.70", { "19": "238.00", "7": "10.70" })),
    );
    // The invoice stated the book at 10.70 (7%) — what a returned book is credited at.
    const invoiceWithLines = {
      ...ORIGINAL_INVOICE,
      line_values: [
        { itemId: "item_widget", rate: "19", quantity: "2", gross: "238.00" },
        { itemId: "item_book", rate: "7", quantity: "1", gross: "10.70" },
      ],
    };
    const einvoiceService = makeEinvoiceService({
      listEinvoiceDocuments: async (filter) =>
        filter["type"] === "invoice" ? [invoiceWithLines] : [],
    });
    const book = {
      id: "item_book",
      title: "Book",
      unit_price: 10,
      is_tax_inclusive: false,
      tax_lines: [{ rate: 7 }],
      detail: { quantity: 1 },
    };
    const { container } = makeContainer({
      einvoiceService,
      payment: {
        id: "pay_01",
        payment_collection_id: "paycol_01",
        refunds: [{ id: "refund_01", amount: 15.7 }],
      },
      orders: [
        {
          ...ORDER,
          items: [{ ...ORDER.items[0], id: "item_widget" }, book],
        },
      ],
      returns: [
        {
          id: "return_01",
          status: "received",
          received_at: "2026-01-20T10:00:00Z",
          items: [{ item_id: "item_book", received_quantity: 1 }],
        },
      ],
    });

    await creditNoteOnPaymentRefunded(makeArgs(container, { id: "pay_01" }));

    const creditNote = mocks.buildInvoice.mock.calls.at(-1)?.[0] as {
      readonly lines: readonly { readonly priceInclVat?: string; readonly itemName: string }[];
    };
    // The book (10.70 at 7%) first; the 5.00 left over 238.00 : 0.00 still uncredited — all at 19%.
    expect(creditNote.lines.map((line) => [line.priceInclVat, line.itemName])).toEqual([
      ["10.70", "Rückgabe / Return — Rechnung RE-2026-0001"],
      ["5.00", "Teilerstattung / Partial refund — Rechnung RE-2026-0001"],
    ]);
    expect(einvoiceService.recordDocumentIfAbsent).toHaveBeenCalledWith(
      expect.objectContaining({
        coveredReturns: [{ returnId: "return_01", rate: "7", gross: "10.70" }],
      }),
    );
  });

  it("credits nothing for a refund that returns an overpayment the invoice's notice names, and only the rest of a later one (P-63)", async () => {
    // The invoice states 238.00; Medusa charged 38.00 more, which the notice says to refund.
    const invoiceWithNotice = {
      ...ORIGINAL_INVOICE,
      notice: { code: "VAT_OVERCHARGED", refundDue: "38.00" },
    };
    const einvoiceService = makeEinvoiceService({
      listEinvoiceDocuments: async (filter) =>
        filter["type"] === "invoice" ? [invoiceWithNotice] : [],
    });
    const refunds = [
      { id: "refund_01", amount: 38, created_at: "2026-01-02T10:00:00Z" },
      { id: "refund_02", amount: 50, created_at: "2026-01-03T10:00:00Z" },
    ];
    const { container } = makeContainer({
      einvoiceService,
      payment: { id: "pay_01", payment_collection_id: "paycol_01", refunds },
      orders: [{ ...ORDER, payment_collections: [{ payments: [{ refunds }] }] }],
    });

    await creditNoteOnPaymentRefunded(makeArgs(container, { id: "pay_01" }));

    expect(einvoiceService.recordDocumentIfAbsent).toHaveBeenCalledTimes(1);
    expect(einvoiceService.recordDocumentIfAbsent).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: "refund_02" }),
    );
    const creditNote = mocks.buildInvoice.mock.calls.at(-1)?.[0] as {
      readonly lines: readonly { readonly priceInclVat?: string }[];
    };
    expect(creditNote.lines[0]?.priceInclVat).toBe("50.00");
    const info = mocks.logger.info.mock.calls.map((call) => String(call[0])).join("\n");
    expect(info).toContain("refund_01");
  });
});
