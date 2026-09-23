import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MedusaContainer, SubscriberArgs } from "@medusajs/framework";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { EINVOICE_MODULE } from "../modules/einvoice/index.js";
import type EinvoiceModuleService from "../modules/einvoice/service.js";

// Orchestration only, like the other subscriber tests: the core packages are mocked.
const mocks = vi.hoisted(() => ({
  selectProfile: vi.fn(() => "EN16931" as const),
  buildInvoice: vi.fn((input: unknown) => ({
    invoice: { ...(input as object), totals: { totalAmountWithVat: "214.20" } },
    warnings: [],
  })),
  decideVatCategory: vi.fn(() => ({ categoryCode: "S", ruleId: "tax-semantics#1" })),
  serializeCii: vi.fn(() => ({ xml: "<xml/>" })),
  storeEinvoiceFiles: vi.fn(async () => ({
    xmlFileId: "file_xml",
    pdfFileId: null as string | null,
  })),
  deleteEinvoiceFiles: vi.fn(async () => undefined),
  fetchFileBytes: vi.fn(),
  logger: { warn: vi.fn() },
}));

vi.mock("@normwerk/einvoice-commerce", () => ({
  DE_STANDARD_RATE: "19",
  DE_REDUCED_RATE: "7",
  selectProfile: mocks.selectProfile,
  buildInvoice: mocks.buildInvoice,
  decideVatCategory: mocks.decideVatCategory,
  // The rate a line resolves to — here simply the rate it was charged at.
  resolveLineRate: (_d: unknown, _c: unknown, kind: unknown, charged: unknown) => charged ?? kind,
  SequentialNumberer: class {
    next = vi.fn(async () => "GS-2026-0002");
  },
}));

vi.mock("@normwerk/einvoice-cii", () => ({ serializeCii: mocks.serializeCii }));

vi.mock("../storage.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../storage.js")>();
  return {
    ...actual,
    storeEinvoiceFiles: mocks.storeEinvoiceFiles,
    deleteEinvoiceFiles: mocks.deleteEinvoiceFiles,
    fetchFileBytes: mocks.fetchFileBytes,
  };
});

import creditNoteOnOrderCanceled from "./credit-note-on-order-canceled.js";

const ORDER = {
  id: "order_01",
  display_id: 1,
  email: "buyer@example.test",
  currency_code: "eur",
  customer: { company_name: "Buyer GmbH", email: "buyer@example.test" },
  billing_address: { country_code: "de", city: "Munich", postal_code: "80331" },
  shipping_address: null,
  items: [
    {
      title: "Widget",
      unit_price: 100,
      is_tax_inclusive: false,
      tax_lines: [{ rate: 19 }],
      detail: { quantity: 2 },
    },
  ],
};
const INVOICE = { id: "doc_invoice", document_number: "RE-2026-0001", xml_file_id: "file_invoice" };
const PARTIAL_CREDIT = {
  id: "doc_credit",
  document_number: "GS-2026-0001",
  xml_file_id: "file_credit",
};

function cii(grandTotal: string): Uint8Array {
  return new TextEncoder().encode(
    "<ram:IssueDateTime><udt:DateTimeString>20260101</udt:DateTimeString></ram:IssueDateTime>" +
      `<ram:GrandTotalAmount>${grandTotal}</ram:GrandTotalAmount>`,
  );
}

function setup(
  documents: { invoices: readonly unknown[]; creditNotes: readonly unknown[] },
  options: Record<string, unknown> = {},
): { container: MedusaContainer; service: EinvoiceModuleService } {
  const service = {
    options: {
      seller: {
        name: "Musterfirma GmbH",
        countryCode: "DE",
        addressLine1: "Musterstraße 1",
        city: "Berlin",
        postCode: "10115",
      },
      payment: { means: "58" },
      ...options,
    },
    listEinvoiceDocuments: vi.fn(async (filter: Record<string, unknown>) => {
      if (filter["type"] === "invoice") return documents.invoices;
      if (filter["idempotency_key"] !== undefined) {
        return documents.creditNotes.filter(
          (d) => (d as { idempotency_key?: string }).idempotency_key === filter["idempotency_key"],
        );
      }
      return documents.creditNotes;
    }),
    recordDocumentIfAbsent: vi.fn(async () => ({ document: {}, created: true })),
  } as unknown as EinvoiceModuleService;
  const registry = new Map<unknown, unknown>([
    [EINVOICE_MODULE, service],
    [ContainerRegistrationKeys.QUERY, { graph: vi.fn(async () => ({ data: [ORDER] })) }],
    [ContainerRegistrationKeys.LOGGER, mocks.logger],
  ]);
  const container = { resolve: (key: unknown) => registry.get(key) } as unknown as MedusaContainer;
  return { container, service };
}

function args(container: MedusaContainer): SubscriberArgs<{ id: string }> {
  return { event: { data: { id: "order_01" } }, container } as unknown as SubscriberArgs<{
    id: string;
  }>;
}

describe("creditNoteOnOrderCanceled (P-41)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchFileBytes.mockImplementation(async (_c: unknown, fileId: unknown) =>
      cii(fileId === "file_credit" ? "23.80" : "238.00"),
    );
  });

  it("reverses the whole invoice when nothing was credited before", async () => {
    const { container, service } = setup({ invoices: [INVOICE], creditNotes: [] });
    await creditNoteOnOrderCanceled(args(container));
    // The whole order restated — its own line, not a one-line "remaining amount" credit.
    const [whole] = mocks.buildInvoice.mock.calls[0] as unknown as [
      { lines: readonly { itemName: string }[] },
    ];
    expect(whole.lines.map((line) => line.itemName)).toEqual(["Widget"]);
    expect(service.recordDocumentIfAbsent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "credit_note", idempotencyKey: "order.canceled:order_01" }),
    );
  });

  it("credits only what is still outstanding after an earlier partial refund", async () => {
    const { container } = setup({ invoices: [INVOICE], creditNotes: [PARTIAL_CREDIT] });
    await creditNoteOnOrderCanceled(args(container));
    const [input] = mocks.buildInvoice.mock.calls[0] as unknown as [
      { lines: readonly { itemName: string; priceInclVat: string }[] },
    ];
    expect(input.lines[0]?.priceInclVat).toBe("214.20");
    expect(input.lines[0]?.itemName).toContain("Stornierung");
  });

  it("does nothing for an order that was never invoiced, or already credited for this cancellation", async () => {
    const neverInvoiced = setup({ invoices: [], creditNotes: [] });
    await creditNoteOnOrderCanceled(args(neverInvoiced.container));
    const alreadyCredited = setup({
      invoices: [INVOICE],
      creditNotes: [{ ...PARTIAL_CREDIT, idempotency_key: "order.canceled:order_01" }],
    });
    await creditNoteOnOrderCanceled(args(alreadyCredited.container));
    expect(mocks.buildInvoice).not.toHaveBeenCalled();
  });

  it("issues nothing in Webbers mode and says so — their plugin has no credit invoice for a cancellation", async () => {
    const { container } = setup(
      { invoices: [INVOICE], creditNotes: [] },
      { integration: { kind: "webbers" } },
    );
    await creditNoteOnOrderCanceled(args(container));
    expect(mocks.buildInvoice).not.toHaveBeenCalled();
    expect(mocks.logger.warn).toHaveBeenCalledWith(expect.stringContaining("issue it yourself"));
  });
});
