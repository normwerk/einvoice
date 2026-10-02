import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MedusaContainer } from "@medusajs/framework";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import type EinvoiceModuleService from "../modules/einvoice/service.js";
import type { MedusaOrderForInvoice } from "../mapping/order-to-commerce-invoice-input.js";

// T-211: `planCreditNote` decides a credit note and writes nothing. What the commit writes is tested through
// the subscribers (`subscribers/credit-note-on-*.test.ts`); the core packages are mocked for the same reason
// as there.
const mocks = vi.hoisted(() => ({
  selectProfile: vi.fn(() => "EN16931" as const),
  buildInvoice: vi.fn((input: unknown) => ({
    invoice: { ...(input as object), totals: { totalAmountWithVat: "238.00" } },
    warnings: [],
    decisions: [],
  })),
  serializeCii: vi.fn(() => ({ xml: "<xml/>" })),
  storeEinvoiceFiles: vi.fn(async () => ({ xmlFileId: "file_xml", pdfFileId: null })),
  logger: { warn: vi.fn(), info: vi.fn() },
  eventBus: { emit: vi.fn(async () => undefined) },
  nextNumber: vi.fn(async () => "GS-2026-0001"),
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

vi.mock("@normwerk/einvoice-cii", () => ({ serializeCii: mocks.serializeCii }));

vi.mock("../storage.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../storage.js")>()),
  storeEinvoiceFiles: mocks.storeEinvoiceFiles,
}));

import { planCreditNote, type CreditBasis } from "./issue-credit-note.js";

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
    },
  ],
} as unknown as MedusaOrderForInvoice;

const BASIS = {
  invoice: {
    id: "einvdoc_01",
    order_id: "order_01",
    document_number: "RE-2026-0001",
    line_values: [],
    includes_shipping: true,
    tax_decisions: null,
    vat_id_evidence: null,
  },
  invoiceIssueDate: "2026-01-15",
  invoiceDeliveryDate: "2026-01-15",
  invoiceTotal: "238.00",
  creditedTotals: [],
  overpaid: "0.00",
  uncreditedByRate: [{ rate: "19", gross: "238.00" }],
  coveredReturns: [],
  invoicedLines: [],
} as unknown as CreditBasis;

/** A service whose every write is a spy — a plan must call none of them. */
function makeEinvoiceService(options: Record<string, unknown> = {}) {
  return {
    options: {
      seller: {
        name: "Musterfirma GmbH",
        countryCode: "DE",
        addressLine1: "Musterstraße 1",
        city: "Berlin",
        postCode: "10115",
        vatIdentifier: "DE123456789",
      },
      payment: { means: "58", iban: "DE89370400440532013000" },
      ...options,
    },
    listEinvoiceDocuments: vi.fn(async () => []),
    recordDocumentIfAbsent: vi.fn(),
    allocateNextNumber: vi.fn(),
    recordRefusal: vi.fn(),
    clearRefusal: vi.fn(),
  };
}

const container = {
  resolve: (key: unknown) =>
    new Map<unknown, unknown>([
      [ContainerRegistrationKeys.QUERY, { graph: async () => ({ data: [] }) }],
      [ContainerRegistrationKeys.LOGGER, mocks.logger],
      [Modules.EVENT_BUS, mocks.eventBus],
    ]).get(key),
} as unknown as MedusaContainer;

function expectNothingWritten(einvoiceService: ReturnType<typeof makeEinvoiceService>): void {
  expect(einvoiceService.recordRefusal).not.toHaveBeenCalled();
  expect(einvoiceService.clearRefusal).not.toHaveBeenCalled();
  expect(einvoiceService.recordDocumentIfAbsent).not.toHaveBeenCalled();
  expect(einvoiceService.allocateNextNumber).not.toHaveBeenCalled();
  expect(mocks.nextNumber).not.toHaveBeenCalled();
  expect(mocks.storeEinvoiceFiles).not.toHaveBeenCalled();
  expect(mocks.eventBus.emit).not.toHaveBeenCalled();
  expect(mocks.logger.warn).not.toHaveBeenCalled();
}

describe("planCreditNote (T-211)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("decides a refused credit note without recording, announcing or numbering anything", async () => {
    const refusal = Object.assign(new Error("needs a positive VIES check"), {
      code: "VAT_ID_UNVERIFIED",
    });
    mocks.buildInvoice.mockImplementationOnce(() => {
      throw refusal;
    });
    const einvoiceService = makeEinvoiceService();

    const plan = await planCreditNote({
      container,
      einvoiceService: einvoiceService as unknown as EinvoiceModuleService,
      order: ORDER,
      basis: BASIS,
      scope: { kind: "full" },
      reason: "refund",
    });

    expect(plan).toEqual({ kind: "refused", error: refusal });
    expectNothingWritten(einvoiceService);
  });

  it("hands back the credit note built without a number, and never asks the shop for its PDF", async () => {
    const basePdf = vi.fn(async () => new Uint8Array([9]));
    const einvoiceService = makeEinvoiceService({ standalone: { basePdf } });

    const plan = await planCreditNote({
      container,
      einvoiceService: einvoiceService as unknown as EinvoiceModuleService,
      order: ORDER,
      basis: BASIS,
      scope: { kind: "full" },
      reason: "refund",
    });

    expect(plan.kind).toBe("ready");
    expect(mocks.buildInvoice).toHaveBeenCalledTimes(1);
    expect(mocks.buildInvoice).toHaveBeenCalledWith(
      expect.objectContaining({ document: expect.objectContaining({ number: "UNALLOCATED" }) }),
      {},
    );
    expect(plan).toMatchObject({ check: mocks.buildInvoice.mock.results[0]?.value });
    expect(basePdf).not.toHaveBeenCalled();
    expect(mocks.serializeCii).not.toHaveBeenCalled();
    expectNothingWritten(einvoiceService);
  });

  it("checks the buyer's VAT-ID with the verifier it is given instead of the plugin's own", async () => {
    const evidence = {
      vatId: "FR98765432109",
      status: "valid" as const,
      checkedAt: "2026-01-15",
      consultationNumber: "WAPIAAAAW1",
    };
    const configured = { verify: vi.fn() };
    const given = { verify: vi.fn(async () => evidence) };
    const einvoiceService = makeEinvoiceService({ vatIdVerifier: configured });
    const order = {
      ...ORDER,
      customer: { ...ORDER.customer, metadata: { vat_id: "FR98765432109" } },
    } as unknown as MedusaOrderForInvoice;

    const plan = await planCreditNote(
      {
        container,
        einvoiceService: einvoiceService as unknown as EinvoiceModuleService,
        order,
        basis: BASIS,
        scope: { kind: "full" },
        reason: "refund",
      },
      { vatIdVerifier: given },
    );

    expect(given.verify).toHaveBeenCalledWith("FR98765432109", expect.any(Date));
    expect(configured.verify).not.toHaveBeenCalled();
    expect(plan).toMatchObject({ kind: "ready", buildOptions: { vatIdEvidence: evidence } });
  });
});
