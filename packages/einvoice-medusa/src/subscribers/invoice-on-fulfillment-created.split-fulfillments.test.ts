/**
 * T-133 (gap 4b, `ecom docs/plan-v0.1-pending.md` P-30): the workaround an error message might one day
 * recommend for a cross-border mixed-category order — "split into two shipments/documents" — had never
 * been run against the real subscriber. This file drives `invoiceOnFulfillmentCreated` twice, for two
 * different `fulfillment_id`s on the *same* order, through the real, unmocked `mapOrderToCommerceInvoiceInput`
 * → `buildInvoice` path — only `../storage.js` (file I/O) and `@normwerk/einvoice-cii`/`@normwerk/einvoice-pdfa`
 * (serialization/PDF embedding, irrelevant to this finding) are mocked; `@normwerk/einvoice-commerce` runs
 * for real, the same "real, unmocked adapter" principle `../tax-matrix/tax-matrix.test.ts` uses.
 *
 * Finding: numbering and idempotency genuinely don't collide (two distinct `fulfillment_id`s are two
 * distinct idempotency keys, so `SequentialNumberer` is asked for — and gives — two distinct numbers, and
 * neither `recordDocumentIfAbsent` call overwrites the other). But `invoiceOnFulfillmentCreated` never reads
 * `fulfillment_id` for anything beyond the idempotency key — it (re)maps the *entire* order via
 * `ORDER_QUERY_FIELDS`/`mapOrderToCommerceInvoiceInput` every time, regardless of which items the triggering
 * fulfillment actually shipped. Two fulfillments of one order therefore do not produce "two documents, each
 * scoped to its own shipment, each with its own category" — they produce two *duplicate*, full-order
 * invoices, same lines and same category both times. An error message that recommends "split into two
 * shipments" as an escape hatch for a mixed-category order would be recommending something this plugin
 * cannot actually do today — see P-30.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MedusaContainer, SubscriberArgs } from "@medusajs/framework";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { EINVOICE_MODULE } from "../modules/einvoice/index.js";
import type EinvoiceModuleService from "../modules/einvoice/service.js";

const mocks = vi.hoisted(() => ({
  serializeCii: vi.fn(() => ({ xml: "<xml/>" })),
  embedInvoiceInPdfA3: vi.fn(async () => ({ pdfBytes: new Uint8Array([1, 2, 3]) })),
  storeEinvoiceFiles: vi.fn(async () => ({
    xmlFileId: "file_xml",
    pdfFileId: null as string | null,
  })),
  deleteEinvoiceFiles: vi.fn(async () => undefined),
}));

// `@normwerk/einvoice-commerce` is deliberately left unmocked — the whole point of this file is proving
// what the real `mapOrderToCommerceInvoiceInput` → `buildInvoice` path actually does across two calls.
vi.mock("@normwerk/einvoice-cii", () => ({ serializeCii: mocks.serializeCii }));
vi.mock("@normwerk/einvoice-pdfa", () => ({ embedInvoiceInPdfA3: mocks.embedInvoiceInPdfA3 }));
vi.mock("../storage.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../storage.js")>();
  return {
    ...actual,
    storeEinvoiceFiles: mocks.storeEinvoiceFiles,
    deleteEinvoiceFiles: mocks.deleteEinvoiceFiles,
  };
});

import invoiceOnFulfillmentCreated from "./invoice-on-fulfillment-created.js";

const SELLER = {
  name: "Musterfirma GmbH",
  countryCode: "DE" as const,
  addressLine1: "Musterstraße 1",
  city: "Berlin",
  postCode: "10115",
  vatIdentifier: "DE123456789",
  electronicAddress: "invoicing@musterfirma.example",
  electronicAddressScheme: "EM" as const,
  contact: {
    name: "Anna Muster",
    telephone: "+49 30 1234567",
    email: "invoicing@musterfirma.example",
  },
};
const PAYMENT = { means: "58" as const, iban: "DE89370400440532013000" };

// One goods line, one service line — the shape a merchant splitting a mixed-category cross-border order
// into "two shipments" would be hoping for; kept domestic here so category resolution itself isn't in
// question (this file is about whether fulfillment scopes *which lines* get invoiced, not about which
// category they resolve to — that's `mixed-basket-domestic`/`mixed-basket-cross-border`'s concern).
const ORDER = {
  id: "order_split_01",
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
      title: "Goods line",
      variant_sku: "GOODS-1",
      unit_price: 100,
      is_tax_inclusive: false,
      tax_lines: [{ rate: 19 }],
      detail: { quantity: 1 },
    },
    {
      title: "Service line",
      variant_sku: "SVC-1",
      unit_price: 50,
      is_tax_inclusive: false,
      tax_lines: [{ rate: 19 }],
      detail: { quantity: 1 },
    },
  ],
  // What Medusa charged — the invoice is checked against it before a number is taken (P-63).
  total: 178.5,
  tax_total: 28.5,
};

function makeEinvoiceService(): EinvoiceModuleService {
  let nextNumber = 0;
  return {
    options: { seller: SELLER, payment: PAYMENT },
    listEinvoiceDocuments: vi.fn(async () => []),
    recordDocumentIfAbsent: vi.fn(async () => ({ document: {}, created: true })),
    clearRefusal: vi.fn(async () => undefined),
    allocateNextNumber: vi.fn(async () => {
      nextNumber += 1;
      return nextNumber;
    }),
  } as unknown as EinvoiceModuleService;
}

function makeContainer(einvoiceService: EinvoiceModuleService): MedusaContainer {
  const graph = vi.fn(async () => ({ data: [ORDER] }));
  const registry = new Map<unknown, unknown>([
    [EINVOICE_MODULE, einvoiceService],
    [ContainerRegistrationKeys.QUERY, { graph }],
    [ContainerRegistrationKeys.LOGGER, { warn: vi.fn(), info: vi.fn() }],
  ]);
  return { resolve: (key: unknown) => registry.get(key) } as unknown as MedusaContainer;
}

function makeArgs(
  container: MedusaContainer,
  fulfillmentId: string,
): SubscriberArgs<{ order_id: string; fulfillment_id: string }> {
  return {
    event: { data: { order_id: ORDER.id, fulfillment_id: fulfillmentId } },
    container,
  } as unknown as SubscriberArgs<{ order_id: string; fulfillment_id: string }>;
}

describe("invoiceOnFulfillmentCreated: two fulfillments on one order (T-133 gap 4b, P-30)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("allocates two non-colliding numbers and never overwrites the first document", async () => {
    const einvoiceService = makeEinvoiceService();
    const container = makeContainer(einvoiceService);

    await invoiceOnFulfillmentCreated(makeArgs(container, "ful_1"));
    await invoiceOnFulfillmentCreated(makeArgs(container, "ful_2"));

    expect(einvoiceService.recordDocumentIfAbsent).toHaveBeenCalledTimes(2);
    expect(einvoiceService.recordDocumentIfAbsent).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ idempotencyKey: "ful_1", documentNumber: "RE-2026-0001" }),
    );
    expect(einvoiceService.recordDocumentIfAbsent).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ idempotencyKey: "ful_2", documentNumber: "RE-2026-0002" }),
    );
  });

  it("maps the whole order on both calls — the two documents are duplicates, not a per-shipment split (real finding, not asserted away)", async () => {
    const einvoiceService = makeEinvoiceService();
    const container = makeContainer(einvoiceService);

    await invoiceOnFulfillmentCreated(makeArgs(container, "ful_1"));
    await invoiceOnFulfillmentCreated(makeArgs(container, "ful_2"));

    expect(mocks.serializeCii).toHaveBeenCalledTimes(2);
    const [firstCall, secondCall] = mocks.serializeCii.mock.calls as unknown as [
      [{ lines: readonly { itemName: string }[] }],
      [{ lines: readonly { itemName: string }[] }],
    ];
    const [firstInvoice] = firstCall;
    const [secondInvoice] = secondCall;

    // Both documents carry the *same two lines* (goods + service) — proving `fulfillment_id` never scopes
    // which items get invoiced. If this plugin ever adds real per-fulfillment line splitting, this
    // assertion is exactly what should start failing (change it deliberately then, don't delete it).
    expect(firstInvoice.lines.map((l) => l.itemName).sort()).toEqual([
      "Goods line",
      "Service line",
    ]);
    expect(secondInvoice.lines.map((l) => l.itemName).sort()).toEqual([
      "Goods line",
      "Service line",
    ]);
  });
});
