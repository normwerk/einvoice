/**
 * T-214: the dry run over a shop's orders, through the real, unmocked plan — `mapOrderToCommerceInvoiceInput`,
 * `@normwerk/einvoice-commerce`'s `buildInvoice` and `@normwerk/einvoice-cii`'s `serializeCii` all run for real;
 * only Medusa (the container, Query) is stood in for. Covers the outcome of each kind of order, the run's
 * register (an order's second invoice without the shipping), that nothing is written, and that the report
 * carries no personal data from the tax-matrix fixtures.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MedusaContainer } from "@medusajs/framework";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import { EINVOICE_MODULE } from "../modules/einvoice/index.js";
import type EinvoiceModuleService from "../modules/einvoice/service.js";
import type { MedusaFulfillment } from "../mapping/shipment.js";
import { loadSellers, loadTaxMatrixCells } from "../tax-matrix/load-cells.js";
import { dryRunReport, planOrders, type DryRunOrderSelection } from "./run.js";
import type { DryRunVersions } from "./versions.js";

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

const BUYER = {
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
};

const GOODS = {
  id: "item_goods",
  title: "Goods line",
  variant_sku: "GOODS-1",
  unit_price: 100,
  is_tax_inclusive: false,
  tax_lines: [{ rate: 19 }],
  detail: { quantity: 1 },
  total: 119,
  tax_total: 19,
};

/** Two fulfillments, the order's shipping on the first invoice only; one refund. */
const SPLIT = {
  id: "order_split",
  display_id: 1,
  created_at: "2026-09-01T08:00:00Z",
  ...BUYER,
  items: [
    GOODS,
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
      id: "ful_split_1",
      created_at: "2026-09-10T08:00:00Z",
      items: [{ line_item_id: "item_goods", quantity: 1 }],
    },
    {
      id: "ful_split_2",
      created_at: "2026-09-12T08:00:00Z",
      items: [{ line_item_id: "item_service", quantity: 1 }],
    },
  ],
  payment_collections: [
    { payments: [{ refunds: [{ id: "ref_split", created_at: "2026-09-20T08:00:00Z" }] }] },
  ],
  total: 190.4,
  tax_total: 30.4,
};

function single(id: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    display_id: 2,
    created_at: "2026-09-02T08:00:00Z",
    ...BUYER,
    items: [GOODS],
    fulfillments: [
      {
        id: `ful_${id}`,
        created_at: "2026-09-15T08:00:00Z",
        items: [{ line_item_id: "item_goods", quantity: 1 }],
      },
    ],
    total: 119,
    tax_total: 19,
    ...overrides,
  };
}

const ITALY = single("order_italy", {
  billing_address: {
    ...BUYER.billing_address,
    country_code: "it",
    city: "Milano",
    postal_code: "20121",
  },
});
const CANCELED = single("order_canceled", {
  fulfillments: [
    {
      id: "ful_order_canceled",
      created_at: "2026-09-15T08:00:00Z",
      canceled_at: "2026-09-16T08:00:00Z",
      items: [{ line_item_id: "item_goods", quantity: 1 }],
    },
  ],
});
const EDITED = single("order_edited");
const BROKEN = single("order_broken");
const LATER = single("order_later", {
  fulfillments: [
    {
      id: "ful_order_later",
      created_at: "2026-10-03T08:00:00Z",
      items: [{ line_item_id: "item_goods", quantity: 1 }],
    },
  ],
});

const VERSIONS: DryRunVersions = {
  plugin: { name: "@normwerk/einvoice-medusa", version: "0.1.0" },
  platform: { name: "Medusa", version: "2.21.2" },
  nodeVersion: "22.12.0",
  core: [{ name: "@normwerk/einvoice-commerce", version: "0.1.0" }],
  rulesSha256: "0".repeat(64),
};

const eventBus = { emit: vi.fn(async () => undefined) };
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

function makeService(options: Record<string, unknown> = {}) {
  return {
    options: { seller: SELLER, payment: PAYMENT, ...options },
    listEinvoiceDocuments: vi.fn(async () => []),
    recordDocumentIfAbsent: vi.fn(),
    allocateNextNumber: vi.fn(),
    recordRefusal: vi.fn(),
    clearRefusal: vi.fn(),
  };
}

interface ShopOptions {
  /** When each order's edits were confirmed. */
  readonly edits?: Readonly<Record<string, readonly string[]>>;
  /** Returns each order received: when, and which line items came back. */
  readonly returns?: Readonly<Record<string, readonly { at: string; items: readonly string[] }[]>>;
  /** Orders whose exchanges cannot be read — a defect stands in. */
  readonly broken?: readonly string[];
}

function makeContainer(
  service: ReturnType<typeof makeService>,
  orders: readonly Record<string, unknown>[],
  { edits = {}, returns = {}, broken = [] }: ShopOptions = {},
): MedusaContainer {
  const orderById = (id: unknown) => orders.find((order) => order["id"] === id);
  const graph = vi.fn(
    async ({
      entity,
      filters = {},
      pagination,
    }: {
      entity: string;
      filters?: Record<string, unknown>;
      pagination?: { skip: number };
    }) => {
      switch (entity) {
        case "order": {
          if (pagination !== undefined) return { data: pagination.skip === 0 ? orders : [] };
          const ids = Array.isArray(filters["id"]) ? filters["id"] : [filters["id"]];
          return { data: ids.map(orderById).filter((order) => order !== undefined) };
        }
        case "order_change": {
          const orderId = String(filters["order_id"]);
          const fulfillments = (orderById(orderId)?.["fulfillments"] ??
            []) as readonly MedusaFulfillment[];
          const edited = (edits[orderId] ?? []).map((confirmed_at) => ({
            change_type: "edit",
            status: "confirmed",
            confirmed_at,
            actions: [],
          }));
          const received = (returns[orderId] ?? []).map(({ at, items }) => ({
            change_type: "return_receive",
            status: "confirmed",
            confirmed_at: at,
            actions: items.map((item) => ({
              action: "RECEIVE_RETURN_ITEM",
              details: { reference_id: item },
            })),
          }));
          return {
            data: [
              ...edited,
              ...received,
              ...fulfillments.map((fulfillment) => ({
                change_type: null,
                status: "confirmed",
                confirmed_at: fulfillment.created_at,
                actions: (fulfillment.items ?? []).map((item) => ({
                  action: "FULFILL_ITEM",
                  reference_id: fulfillment.id,
                  details: { reference_id: item.line_item_id, quantity: item.quantity },
                })),
              })),
            ],
          };
        }
        case "order_exchange":
          if (broken.includes(String(filters["order_id"]))) {
            throw new TypeError("Cannot read properties of undefined (reading 'Beispielstraße 1')");
          }
          return { data: [] };
        default:
          return { data: [] };
      }
    },
  );
  const registry = new Map<unknown, unknown>([
    [EINVOICE_MODULE, service as unknown as EinvoiceModuleService],
    [ContainerRegistrationKeys.QUERY, { graph }],
    [ContainerRegistrationKeys.LOGGER, logger],
    [Modules.EVENT_BUS, eventBus],
  ]);
  return { resolve: (key: unknown) => registry.get(key) } as unknown as MedusaContainer;
}

const SEPTEMBER: DryRunOrderSelection = { kind: "period", from: "2026-09-01", to: "2026-09-30" };

function grandTotal(xml: string | undefined): string | undefined {
  return /<ram:GrandTotalAmount>([^<]+)</.exec(xml ?? "")?.[1];
}

describe("planOrders (T-214)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("plans an order's second fulfillment after its first: the shipping on the first invoice only", async () => {
    const planned = await planOrders(makeContainer(makeService(), [SPLIT]), SEPTEMBER, {
      issuedDocuments: true,
    });

    expect(planned.assessments.map(({ outcome }) => outcome.class)).toEqual([
      "would-issue",
      "would-issue",
      "not-assessed",
    ]);
    expect(grandTotal(planned.xml.get("ful_split_1"))).toBe("130.90");
    expect(grandTotal(planned.xml.get("ful_split_2"))).toBe("59.50");
    expect(planned.assessments[2]).toEqual({
      document: {
        type: "credit-note",
        orderId: "order_split",
        trigger: "refund",
        refundId: "ref_split",
      },
      outcome: { class: "not-assessed", limitation: "CREDIT_NOTES_NOT_ASSESSED" },
    });
  });

  it("leaves a fulfillment whose item came back unjudged, and still counts what its invoice took", async () => {
    const returned = {
      ...SPLIT,
      id: "order_returned",
      items: SPLIT.items.map((item) =>
        item.id === "item_goods"
          ? { ...item, detail: { quantity: 1, return_received_quantity: 1 } }
          : item,
      ),
      payment_collections: [],
    };

    const planned = await planOrders(
      makeContainer(makeService(), [returned], {
        returns: { order_returned: [{ at: "2026-09-20T08:00:00Z", items: ["item_goods"] }] },
      }),
      SEPTEMBER,
      { issuedDocuments: true },
    );

    expect(planned.assessments.map(({ outcome }) => outcome)).toEqual([
      { class: "not-assessed", limitation: "ORDER_CHANGED_AFTER_SHIPMENT", changes: ["return"] },
      { class: "would-issue", profile: "EN16931", validation: { status: "not-run" } },
    ]);
    // The first invoice, blocked against what Medusa holds after the return, still took the shipping.
    expect(grandTotal(planned.xml.get("ful_split_2"))).toBe("59.50");
  });

  it("states each kind of order's outcome, and counts what it skipped", async () => {
    const service = makeService();
    const planned = await planOrders(
      makeContainer(service, [SPLIT, ITALY, CANCELED, EDITED, BROKEN, LATER], {
        edits: { order_edited: ["2026-09-18T08:00:00Z"] },
        broken: ["order_broken"],
      }),
      SEPTEMBER,
      { issuedDocuments: true },
    );

    const byOrder = Object.fromEntries(
      planned.assessments
        .filter(({ document }) => document.type === "invoice")
        .map(({ document, outcome }) => [document.orderId, outcome]),
    );
    expect(byOrder["order_italy"]).toMatchObject({
      class: "would-refuse",
      refusal: {
        code: "UNSUPPORTED_BUYER_COUNTRY_CLEARANCE",
        docsUrl: "https://normwerk.dev/einvoice/docs/errors#unsupported-buyer-country-clearance",
        country: "IT",
      },
    });
    expect(byOrder["order_italy"]).toHaveProperty(
      "refusal.reason",
      expect.stringMatching(/clearance platform/),
    );
    expect(byOrder["order_edited"]).toEqual({
      class: "not-assessed",
      limitation: "ORDER_CHANGED_AFTER_SHIPMENT",
      changes: ["edit"],
    });
    expect(byOrder["order_broken"]).toMatchObject({
      class: "tool-error",
      error: { stage: "plan", code: "INTERNAL_ERROR", errorClass: "TypeError" },
    });
    expect(byOrder).not.toHaveProperty("order_canceled");
    expect(byOrder).not.toHaveProperty("order_later");
    expect(planned.scope).toEqual({
      orders: 5,
      fulfillments: 6,
      skipped: { alreadyInvoiced: 0, canceled: 1 },
      vatIdChecks: { distinct: 0, confirmed: 0, notConfirmed: 0, unavailable: 0 },
    });
    expect([...planned.xml.keys()]).toEqual(["ful_split_1", "ful_split_2"]);
  });

  it("names a tool error by its code, class and our own frames — never by its message", async () => {
    const planned = await planOrders(
      makeContainer(makeService(), [BROKEN], { broken: ["order_broken"] }),
      SEPTEMBER,
      { issuedDocuments: true },
    );

    const [assessment] = planned.assessments;
    expect(assessment?.outcome.class).toBe("tool-error");
    const json = JSON.stringify(planned.assessments);
    expect(json).toContain('"at":"@normwerk/einvoice-medusa/src/order-replacements.ts:');
    expect(json).not.toContain("Beispielstraße");
    expect(json).not.toContain("Cannot read");
  });

  it("writes nothing, announces nothing, takes no number and logs nothing", async () => {
    const basePdf = vi.fn();
    const service = makeService({ standalone: { basePdf } });

    await planOrders(makeContainer(service, [SPLIT, ITALY]), SEPTEMBER, { issuedDocuments: true });

    expect(service.recordRefusal).not.toHaveBeenCalled();
    expect(service.clearRefusal).not.toHaveBeenCalled();
    expect(service.recordDocumentIfAbsent).not.toHaveBeenCalled();
    expect(service.allocateNextNumber).not.toHaveBeenCalled();
    expect(basePdf).not.toHaveBeenCalled();
    expect(eventBus.emit).not.toHaveBeenCalled();
    expect(logger.info).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("reads the plugin's own documents only when its tables are there", async () => {
    const service = makeService();

    await planOrders(makeContainer(service, [SPLIT]), SEPTEMBER, { issuedDocuments: false });

    expect(service.listEinvoiceDocuments).not.toHaveBeenCalled();
  });

  it("checks each distinct VAT-ID once and counts the answers", async () => {
    const verify = vi.fn(async (vatId: string) => ({
      vatId,
      status: "valid" as const,
      checkedAt: "2026-10-07",
      consultationNumber: "WAPIAAAAW1",
    }));
    const withVatId = (id: string) =>
      single(id, { customer: { ...BUYER.customer, metadata: { vat_id: "FR98765432109" } } });

    const planned = await planOrders(
      makeContainer(makeService({ vatIdVerifier: { verify } }), [
        withVatId("order_a"),
        withVatId("order_b"),
      ]),
      SEPTEMBER,
      { issuedDocuments: true },
    );

    expect(verify).toHaveBeenCalledTimes(1);
    expect(planned.scope.vatIdChecks).toEqual({
      distinct: 1,
      confirmed: 1,
      notConfirmed: 0,
      unavailable: 0,
    });
  });
});

describe("dryRunReport (T-214)", () => {
  it("states the selection and the versions in its header, and leaves the validation to the next step", async () => {
    const planned = await planOrders(makeContainer(makeService(), [SPLIT]), SEPTEMBER, {
      issuedDocuments: true,
    });

    const report = dryRunReport({
      startedAt: new Date("2026-10-07T12:00:00.123Z"),
      versions: VERSIONS,
      selection: SEPTEMBER,
      preflight: [],
      planned,
      shopPdf: true,
    });

    expect(report.header).toMatchObject({
      startedAt: "2026-10-07T12:00:00Z",
      plugin: VERSIONS.plugin,
      rulesSha256: VERSIONS.rulesSha256,
      scope: { selection: { kind: "period", from: "2026-09-01", to: "2026-09-30" }, orders: 1 },
    });
    expect(report.validation).toEqual({ status: "not-run", reason: "not-requested" });
    expect(report.runLimitations).toEqual(["SHOP_PDF_NOT_ASSESSED"]);
  });
});

/** Every name, address, contact and identifier in a value, as text — country codes left out. */
function personalStrings(value: unknown, key = ""): string[] {
  if (typeof value === "string") {
    return /^(country_code|countryCode|currency_code|electronicAddressScheme|status|checkedAt)$/.test(
      key,
    ) || value.length < 4
      ? []
      : [value];
  }
  if (Array.isArray(value)) return value.flatMap((item) => personalStrings(item, key));
  if (typeof value === "object" && value !== null) {
    return Object.entries(value).flatMap(([field, item]) => personalStrings(item, field));
  }
  return [];
}

describe("the dry-run report and personal data (T-214)", () => {
  it("names no buyer or seller of the tax-matrix fixtures: no name, address, contact or VAT-ID", async () => {
    const sellers = loadSellers();
    const json: string[] = [];
    const personal = new Set<string>();
    for (const cell of loadTaxMatrixCells()) {
      const items = cell.order.items.map((item, index) => ({ ...item, id: `item_${index}` }));
      const order = {
        ...cell.order,
        created_at: "2026-09-01T08:00:00Z",
        items,
        fulfillments: [
          {
            id: `ful_${cell.id}`,
            created_at: "2026-09-10T08:00:00Z",
            items: items.map((item) => ({
              line_item_id: item.id,
              quantity: item.detail?.quantity ?? 1,
            })),
          },
        ],
      };
      const seller = sellers[cell.sellerKey];
      const evidence = cell.vatIdEvidence;
      const service = makeService({
        ...cell.mapOptions,
        seller,
        ...(evidence === undefined ? {} : { vatIdVerifier: { verify: async () => evidence } }),
      });
      const planned = await planOrders(makeContainer(service, [order]), SEPTEMBER, {
        issuedDocuments: true,
      });
      json.push(
        JSON.stringify(
          dryRunReport({
            startedAt: new Date("2026-10-07T12:00:00Z"),
            versions: VERSIONS,
            selection: SEPTEMBER,
            preflight: [],
            planned,
            shopPdf: false,
          }),
        ),
      );
      for (const text of [
        ...personalStrings(cell.order.customer),
        ...personalStrings(cell.order.billing_address),
        ...personalStrings(cell.order.shipping_address),
        ...personalStrings({ email: cell.order.email }),
        ...personalStrings(seller),
        ...personalStrings(evidence),
        PAYMENT.iban,
      ]) {
        personal.add(text);
      }
    }

    expect(personal.size).toBeGreaterThan(20);
    const report = json.join("\n");
    expect([...personal].filter((text) => report.includes(text))).toEqual([]);
  });
});
