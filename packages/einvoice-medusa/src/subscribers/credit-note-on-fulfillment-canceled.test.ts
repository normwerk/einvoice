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
    decisions: [],
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

import creditNoteOnFulfillmentCanceled from "./credit-note-on-fulfillment-canceled.js";

// P-67: an order shipped in two fulfillments — a shirt, then a book — each with its own invoice.
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
      id: "item_shirt",
      title: "Shirt",
      unit_price: 100,
      is_tax_inclusive: false,
      tax_lines: [{ rate: 19 }],
      detail: { quantity: 1 },
    },
    {
      id: "item_book",
      title: "Book",
      unit_price: 100,
      is_tax_inclusive: false,
      tax_lines: [{ rate: 19 }],
      detail: { quantity: 1 },
    },
  ],
};
const SECOND_INVOICE = {
  id: "doc_invoice_2",
  order_id: "order_01",
  idempotency_key: "ful_02",
  document_number: "RE-2026-0002",
  xml_file_id: "file_invoice",
  includes_shipping: false,
  line_values: [
    { itemId: "item_book", rate: "19", quantity: "1", gross: "119.00", allowance: "0.00" },
  ],
};

function cii(grandTotal: string): Uint8Array {
  return new TextEncoder().encode(
    "<ram:IssueDateTime><udt:DateTimeString>20260101</udt:DateTimeString></ram:IssueDateTime>" +
      "<ram:ApplicableTradeTax><ram:CalculatedAmount>0.00</ram:CalculatedAmount><ram:TypeCode>VAT</ram:TypeCode>" +
      `<ram:BasisAmount>${grandTotal}</ram:BasisAmount><ram:CategoryCode>S</ram:CategoryCode>` +
      "<ram:RateApplicablePercent>19</ram:RateApplicablePercent></ram:ApplicableTradeTax>" +
      `<ram:GrandTotalAmount>${grandTotal}</ram:GrandTotalAmount>`,
  );
}

function setup(documents: { invoices: readonly unknown[]; creditNotes: readonly unknown[] }): {
  container: MedusaContainer;
  service: EinvoiceModuleService;
} {
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
    },
    listEinvoiceDocuments: vi.fn(async (filter: Record<string, unknown>) => {
      if (filter["type"] === "invoice") {
        return documents.invoices.filter(
          (d) => (d as { idempotency_key?: string }).idempotency_key === filter["idempotency_key"],
        );
      }
      if (filter["idempotency_key"] !== undefined) {
        return documents.creditNotes.filter(
          (d) => (d as { idempotency_key?: string }).idempotency_key === filter["idempotency_key"],
        );
      }
      return documents.creditNotes;
    }),
    recordDocumentIfAbsent: vi.fn(async () => ({ document: {}, created: true })),
    clearRefusal: vi.fn(async () => undefined),
    recordRefusal: vi.fn(async (input: { code: string }) => ({
      id: "einvref_1",
      code: input.code,
    })),
  } as unknown as EinvoiceModuleService;
  const registry = new Map<unknown, unknown>([
    [EINVOICE_MODULE, service],
    [ContainerRegistrationKeys.QUERY, { graph: vi.fn(async () => ({ data: [ORDER] })) }],
    [ContainerRegistrationKeys.LOGGER, mocks.logger],
  ]);
  const container = { resolve: (key: unknown) => registry.get(key) } as unknown as MedusaContainer;
  return { container, service };
}

function args(
  container: MedusaContainer,
  fulfillmentId = "ful_02",
): SubscriberArgs<{ order_id: string; fulfillment_id: string }> {
  return {
    event: { data: { order_id: "order_01", fulfillment_id: fulfillmentId } },
    container,
  } as unknown as SubscriberArgs<{ order_id: string; fulfillment_id: string }>;
}

describe("creditNoteOnFulfillmentCanceled (P-67)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchFileBytes.mockImplementation(async () => cii("119.00"));
  });

  it("reverses the cancelled fulfillment's invoice — its own lines, not the whole order", async () => {
    const { container, service } = setup({ invoices: [SECOND_INVOICE], creditNotes: [] });
    await creditNoteOnFulfillmentCanceled(args(container));
    const [restated] = mocks.buildInvoice.mock.calls[0] as unknown as [
      {
        document: { correctedInvoice: { number: string } };
        lines: readonly { itemName: string }[];
        shipping?: unknown;
      },
    ];
    expect(restated.lines.map((line) => line.itemName)).toEqual(["Book"]);
    expect(restated.shipping).toBeUndefined();
    expect(restated.document.correctedInvoice.number).toBe("RE-2026-0002");
    expect(service.recordDocumentIfAbsent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "credit_note",
        idempotencyKey: "fulfillment.canceled:ful_02",
        correctedDocumentId: "doc_invoice_2",
      }),
    );
  });

  it("does nothing for a fulfillment never invoiced, and drops its refused invoice", async () => {
    const { container, service } = setup({ invoices: [], creditNotes: [] });
    await creditNoteOnFulfillmentCanceled(args(container));
    expect(mocks.buildInvoice).not.toHaveBeenCalled();
    expect(service.clearRefusal).toHaveBeenCalledWith("invoice", "ful_02");
  });

  it("issues the credit note once, however often the event comes", async () => {
    const { container } = setup({
      invoices: [SECOND_INVOICE],
      creditNotes: [{ id: "doc_credit", idempotency_key: "fulfillment.canceled:ful_02" }],
    });
    await creditNoteOnFulfillmentCanceled(args(container));
    expect(mocks.buildInvoice).not.toHaveBeenCalled();
  });
});
