/**
 * P-67 (M-045): two fulfillments of one order are two supplies, each invoiced for what it shipped. This file
 * drives `invoiceOnFulfillmentCreated` twice, for two different `fulfillment_id`s on the *same* order,
 * through the real, unmocked `mapOrderToCommerceInvoiceInput` → `buildInvoice` path — only `../storage.js`
 * (file I/O) and `@normwerk/einvoice-cii`/`@normwerk/einvoice-pdfa` (serialization/PDF embedding) are mocked;
 * `@normwerk/einvoice-commerce` runs for real, the same "real, unmocked adapter" principle
 * `../tax-matrix/tax-matrix.test.ts` uses.
 *
 * Until P-67 each fulfillment re-invoiced the entire order (T-133 gap 4b, P-30): two duplicate full-order
 * invoices, the VAT owed twice. Now the first fulfillment's invoice carries its own line and the order's
 * shipping, the second its own line alone, each dated the day it shipped, and each is checked against what
 * Medusa charged for that shipment.
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

// One goods line and one service line, shipped in two fulfillments; kept domestic so category resolution
// itself isn't in question.
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
      id: "item_goods",
      title: "Goods line",
      variant_sku: "GOODS-1",
      unit_price: 100,
      is_tax_inclusive: false,
      tax_lines: [{ rate: 19 }],
      detail: { quantity: 1 },
      // What Medusa charged per line — each invoice is checked against its own shipment (P-69).
      total: 119,
      tax_total: 19,
    },
    {
      id: "item_service",
      title: "Service line",
      variant_sku: "SVC-1",
      unit_price: 50,
      is_tax_inclusive: false,
      tax_lines: [{ rate: 19 }],
      detail: { quantity: 1 },
      total: 59.5,
      tax_total: 9.5,
    },
  ],
  shipping_methods: [
    {
      name: "Standard",
      is_tax_inclusive: false,
      subtotal: 10,
      discount_subtotal: 0,
      total: 11.9,
      tax_total: 1.9,
    },
  ],
  fulfillments: [
    {
      id: "ful_1",
      created_at: "2026-09-10T08:00:00Z",
      items: [{ line_item_id: "item_goods", quantity: 1 }],
    },
    {
      id: "ful_2",
      created_at: "2026-09-12T08:00:00Z",
      items: [{ line_item_id: "item_service", quantity: 1 }],
    },
  ],
  total: 190.4,
  tax_total: 30.4,
};

function makeEinvoiceService(): EinvoiceModuleService {
  let nextNumber = 0;
  // The documents recorded so far — the second fulfillment's invoice reads what the first one took.
  const documents: Record<string, unknown>[] = [];
  return {
    options: { seller: SELLER, payment: PAYMENT },
    listEinvoiceDocuments: vi.fn(async (filter: Record<string, unknown>) =>
      documents.filter((document) =>
        Object.entries(filter).every(([key, value]) => document[key] === value),
      ),
    ),
    recordDocumentIfAbsent: vi.fn(
      async (input: {
        type: string;
        orderId: string;
        idempotencyKey: string;
        lineValues: unknown;
        includesShipping: boolean;
      }) => {
        const document = {
          type: input.type,
          order_id: input.orderId,
          idempotency_key: input.idempotencyKey,
          line_values: input.lineValues,
          includes_shipping: input.includesShipping,
        };
        documents.push(document);
        return { document, created: true };
      },
    ),
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

describe("invoiceOnFulfillmentCreated: two fulfillments on one order — an invoice per shipment (P-67)", () => {
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

  it("invoices each fulfillment's own lines, the order's shipping on the first, each dated the day it shipped", async () => {
    const einvoiceService = makeEinvoiceService();
    const container = makeContainer(einvoiceService);

    await invoiceOnFulfillmentCreated(makeArgs(container, "ful_1"));
    await invoiceOnFulfillmentCreated(makeArgs(container, "ful_2"));

    expect(mocks.serializeCii).toHaveBeenCalledTimes(2);
    const [[first], [second]] = mocks.serializeCii.mock.calls as unknown as [
      [InvoiceShape],
      [InvoiceShape],
    ];
    expect(first.lines.map((l) => l.itemName)).toEqual(["Goods line"]);
    expect(first.documentLevelCharges?.map((c) => c.amount)).toEqual(["10.00"]);
    expect(first.delivery?.actualDeliveryDate).toBe("2026-09-10");
    expect(first.totals.totalAmountWithVat).toBe("130.90");
    expect(second.lines.map((l) => l.itemName)).toEqual(["Service line"]);
    expect(second.documentLevelCharges).toBeUndefined();
    expect(second.delivery?.actualDeliveryDate).toBe("2026-09-12");
    expect(second.totals.totalAmountWithVat).toBe("59.50");
    expect(einvoiceService.recordDocumentIfAbsent).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ includesShipping: true }),
    );
    expect(einvoiceService.recordDocumentIfAbsent).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ includesShipping: false }),
    );
  });
});

interface InvoiceShape {
  readonly lines: readonly { readonly itemName: string }[];
  readonly documentLevelCharges?: readonly { readonly amount: string }[];
  readonly delivery?: { readonly actualDeliveryDate?: string };
  readonly totals: { readonly totalAmountWithVat: string };
}
