import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MedusaContainer } from "@medusajs/framework";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import { EINVOICE_MODULE } from "../modules/einvoice/index.js";
import type EinvoiceModuleService from "../modules/einvoice/service.js";
import type { MedusaFulfillment, MedusaOrderChange } from "../mapping/shipment.js";

// T-211: `planInvoiceForFulfillment` decides an invoice and writes nothing — the audit command runs it over
// a shop's past orders. The orchestration around it (what the commit writes) is tested through the
// subscriber, `subscribers/invoice-on-fulfillment-created.test.ts`; the core packages are mocked for the same
// reason as there.
const mocks = vi.hoisted(() => ({
  selectProfile: vi.fn(() => "EN16931" as const),
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
  storeEinvoiceFiles: vi.fn(async () => ({ xmlFileId: "file_xml", pdfFileId: null })),
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

vi.mock("@normwerk/einvoice-cii", () => ({ serializeCii: mocks.serializeCii }));

vi.mock("../storage.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../storage.js")>()),
  storeEinvoiceFiles: mocks.storeEinvoiceFiles,
}));

import { planInvoiceForFulfillment } from "./issue-invoice.js";

const SELLER = {
  name: "Musterfirma GmbH",
  countryCode: "DE" as const,
  addressLine1: "Musterstraße 1",
  city: "Berlin",
  postCode: "10115",
  vatIdentifier: "DE123456789",
};

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

/** A service whose every write is a spy — a plan must call none of them. */
function makeEinvoiceService(options: Record<string, unknown> = {}) {
  return {
    options: {
      seller: SELLER,
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

function makeContainer(
  einvoiceService: ReturnType<typeof makeEinvoiceService>,
  order: unknown = ORDER,
): MedusaContainer {
  const fulfillments = (order as { fulfillments?: readonly MedusaFulfillment[] }).fulfillments;
  const changes: MedusaOrderChange[] = (fulfillments ?? []).map((fulfillment) => ({
    actions: (fulfillment.items ?? []).map((item) => ({
      action: "FULFILL_ITEM",
      reference_id: fulfillment.id,
      details: { reference_id: item.line_item_id, quantity: item.quantity },
    })),
  }));
  const graph = async ({ entity }: { entity: string }) => ({
    data: entity === "order" ? [order] : entity === "order_change" ? changes : [],
  });
  const registry = new Map<unknown, unknown>([
    [EINVOICE_MODULE, einvoiceService as unknown as EinvoiceModuleService],
    [ContainerRegistrationKeys.QUERY, { graph }],
    [ContainerRegistrationKeys.LOGGER, mocks.logger],
    [Modules.EVENT_BUS, mocks.eventBus],
  ]);
  return { resolve: (key: unknown) => registry.get(key) } as unknown as MedusaContainer;
}

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

describe("planInvoiceForFulfillment (T-211)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("decides a refused invoice without recording, announcing or numbering anything", async () => {
    const refusal = Object.assign(new Error("needs a positive VIES check"), {
      code: "VAT_ID_UNVERIFIED",
    });
    mocks.buildInvoice.mockImplementationOnce(() => {
      throw refusal;
    });
    const einvoiceService = makeEinvoiceService();

    const plan = await planInvoiceForFulfillment(makeContainer(einvoiceService), {
      orderId: "order_01",
      fulfillmentId: "ful_01",
    });

    expect(plan).toEqual({ kind: "refused", error: refusal });
    expectNothingWritten(einvoiceService);
  });

  it("decides an invoice stating more VAT than Medusa charged as blocked, without recording or announcing it", async () => {
    const einvoiceService = makeEinvoiceService();
    const charged = { ...ORDER.items[0], total: 200, tax_total: 0 };
    const order = { ...ORDER, items: [charged], total: 200, tax_total: 0 };

    const plan = await planInvoiceForFulfillment(makeContainer(einvoiceService, order), {
      orderId: "order_01",
      fulfillmentId: "ful_01",
    });

    expect(plan).toMatchObject({
      kind: "blocked",
      block: { code: "INVOICE_VAT_ABOVE_CHARGED", charged: "200.00", invoiced: "238.00" },
    });
    expectNothingWritten(einvoiceService);
  });

  it("leaves a cancelled fulfillment's refusal where it is", async () => {
    const einvoiceService = makeEinvoiceService();
    const canceled = { ...ORDER.fulfillments[0], canceled_at: "2026-01-16T09:00:00Z" };

    const plan = await planInvoiceForFulfillment(
      makeContainer(einvoiceService, { ...ORDER, fulfillments: [canceled] }),
      { orderId: "order_01", fulfillmentId: "ful_01" },
    );

    expect(plan).toEqual({ kind: "fulfillment-canceled" });
    expectNothingWritten(einvoiceService);
  });

  it("hands back the invoice built without a number, and never asks the shop for its PDF", async () => {
    const basePdf = vi.fn(async () => new Uint8Array([9]));
    const einvoiceService = makeEinvoiceService({ standalone: { basePdf } });

    const plan = await planInvoiceForFulfillment(makeContainer(einvoiceService), {
      orderId: "order_01",
      fulfillmentId: "ful_01",
    });

    expect(plan.kind).toBe("ready");
    if (plan.kind !== "ready") return;
    // One build, the check build: no number taken for it.
    expect(mocks.buildInvoice).toHaveBeenCalledTimes(1);
    expect(mocks.buildInvoice).toHaveBeenCalledWith(
      expect.objectContaining({ document: expect.objectContaining({ number: "UNALLOCATED" }) }),
      {},
    );
    expect(plan.check).toBe(mocks.buildInvoice.mock.results[0]?.value);
    expect(plan.notice).toBeNull();
    expect(plan.shipment.lines).toEqual([
      expect.objectContaining({ itemId: "item_01", quantity: "2" }),
    ]);
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
    };

    const plan = await planInvoiceForFulfillment(
      makeContainer(einvoiceService, order),
      { orderId: "order_01", fulfillmentId: "ful_01" },
      { vatIdVerifier: given },
    );

    expect(given.verify).toHaveBeenCalledWith("FR98765432109", expect.any(Date));
    expect(configured.verify).not.toHaveBeenCalled();
    expect(plan).toMatchObject({ kind: "ready", buildOptions: { vatIdEvidence: evidence } });
  });
});
