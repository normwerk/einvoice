import { describe, expect, it } from "vitest";
import {
  MissingBuyerCountryError,
  issueDateInSellerTimeZone,
  mapOrderToCommerceInvoiceInput,
  type MapOrderOptions,
  type MedusaOrderForInvoice,
} from "./order-to-commerce-invoice-input.js";

const SELLER = {
  name: "Musterfirma GmbH",
  countryCode: "DE" as const,
  addressLine1: "Musterstraße 1",
  city: "Berlin",
  postCode: "10115",
  vatIdentifier: "DE123456789",
};

const PAYMENT = { means: "58" as const, iban: "DE89370400440532013000" };

function baseOptions(overrides: Partial<MapOrderOptions> = {}): MapOrderOptions {
  return {
    seller: SELLER,
    kind: "invoice",
    issueDate: "2026-09-14",
    payment: PAYMENT,
    ...overrides,
  };
}

function baseOrder(overrides: Partial<MedusaOrderForInvoice> = {}): MedusaOrderForInvoice {
  return {
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
    ...overrides,
  };
}

describe("mapOrderToCommerceInvoiceInput", () => {
  it("maps a plain domestic order into a well-formed CommerceInvoiceInput", () => {
    const input = mapOrderToCommerceInvoiceInput(baseOrder(), baseOptions());

    expect(input.schemaVersion).toBe(1);
    expect(input.document).toEqual({
      kind: "invoice",
      issueDate: "2026-09-14",
      currency: "EUR",
      correctedInvoice: undefined,
    });
    expect(input.seller).toBe(SELLER);
    expect(input.buyer).toEqual({
      name: "Buyer GmbH",
      countryCode: "DE",
      addressLine1: "Beispielstraße 1",
      addressLine2: undefined,
      city: "Munich",
      postCode: "80331",
      vatIdentifier: undefined,
      electronicAddress: "buyer@example.test",
      electronicAddressScheme: "EM",
    });
    expect(input.lines).toHaveLength(1);
    expect(input.lines[0]).toMatchObject({
      identifier: "1",
      quantity: "2",
      unitCode: "C62",
      netPrice: "100.0000",
      itemName: "Widget",
      chargedVatRate: "19",
    });
    expect(input.taxContext).toMatchObject({
      sellerCountry: "DE",
      sellerVatId: "DE123456789",
      buyerCountry: "DE",
      buyerIsBusiness: true,
      ossRegistered: false,
      supplyType: "goods",
    });
    expect(input.payment).toBe(PAYMENT);
  });

  it("falls back to the order's own display_id as BT-10 when there is no B2G reference (BR-DE-15)", () => {
    const order = baseOrder({ display_id: 42 });
    const input = mapOrderToCommerceInvoiceInput(order, baseOptions());
    expect(input.references).toEqual({ buyerReference: "42" });
  });

  it("normalizes a lowercase country_code (Medusa's own address column) to uppercase", () => {
    const order = baseOrder({
      billing_address: { country_code: "de", city: "Munich", postal_code: "80331" },
    });
    const input = mapOrderToCommerceInvoiceInput(order, baseOptions());
    expect(input.buyer.countryCode).toBe("DE");
    expect(input.taxContext.buyerCountry).toBe("DE");
  });

  it("passes a tax-inclusive unit price through as priceInclVat — the core takes the VAT out (P-61)", () => {
    const order = baseOrder({
      items: [
        {
          title: "Inclusive widget",
          unit_price: 119,
          is_tax_inclusive: true,
          tax_lines: [{ rate: 19 }],
          detail: { quantity: 1 },
        },
      ],
    });
    const input = mapOrderToCommerceInvoiceInput(order, baseOptions());
    expect(input.lines[0]?.priceInclVat).toBe("119.0000");
    expect(input.lines[0]?.netPrice).toBeUndefined();
  });

  it("takes a tax-inclusive line's discount and shipping VAT-inclusive too, as Medusa charged them (P-61)", () => {
    const order = baseOrder({
      items: [
        {
          title: "T-Shirt",
          unit_price: 10,
          is_tax_inclusive: true,
          tax_lines: [{ rate: 19 }],
          detail: { quantity: 3 },
          discount_total: 3,
          discount_subtotal: 2.5210084033613445,
          adjustments: [{ code: "GROSS10" }],
        },
      ],
      shipping_methods: [
        {
          name: "Standard",
          is_tax_inclusive: true,
          total: 10,
          subtotal: 8.403361344537815,
          discount_subtotal: 0,
        },
      ],
    });
    const input = mapOrderToCommerceInvoiceInput(order, baseOptions());
    // On a VAT-inclusive line the allowance is VAT-inclusive too — Medusa's discount_total, not its net.
    expect(input.lines[0]?.allowances).toEqual([{ amount: "3.00", reason: "GROSS10" }]);
    expect(input.shipping).toEqual({
      amountInclVat: "10.00",
      reason: "Versand / Shipping: Standard",
    });
  });

  it("leaves an exclusive unit price untouched", () => {
    const order = baseOrder({
      items: [
        {
          title: "Exclusive widget",
          unit_price: 42.5,
          is_tax_inclusive: false,
          tax_lines: [{ rate: 19 }],
          detail: { quantity: 1 },
        },
      ],
    });
    const input = mapOrderToCommerceInvoiceInput(order, baseOptions());
    expect(input.lines[0]?.netPrice).toBe("42.5000");
  });

  it("passes on the rate Medusa charged, not a rate kind guessed from it (P-50)", () => {
    const line = (rates: readonly number[]) =>
      mapOrderToCommerceInvoiceInput(
        baseOrder({
          items: [
            {
              title: "Book",
              unit_price: 10,
              is_tax_inclusive: false,
              tax_lines: rates.map((rate) => ({ rate })),
              detail: { quantity: 1 },
            },
          ],
        }),
        baseOptions(),
      ).lines[0];
    expect(line([7])?.chargedVatRate).toBe("7");
    expect(line([7])).not.toHaveProperty("taxRateKind");
    // Snapped to the nearer German rate before — a 0% line became a 7% line on the invoice.
    expect(line([0])?.chargedVatRate).toBe("0");
    expect(line([5.5])?.chargedVatRate).toBe("5.5");
    expect(line([])?.chargedVatRate).toBeUndefined();
  });

  it("defaults quantity to 1 when the linked OrderItem.detail is missing", () => {
    const order = baseOrder({
      items: [
        {
          title: "No detail",
          unit_price: 10,
          is_tax_inclusive: false,
          detail: null,
        },
      ],
    });
    const input = mapOrderToCommerceInvoiceInput(order, baseOptions());
    expect(input.lines[0]?.quantity).toBe("1");
  });

  it("leaves buyer.electronicAddress unset when neither the order nor the customer has an email (BT-49, BR-63)", () => {
    const order = baseOrder({ email: null as unknown as string, customer: null });
    const input = mapOrderToCommerceInvoiceInput(order, baseOptions());
    expect(input.buyer.electronicAddress).toBeUndefined();
    expect(input.buyer.electronicAddressScheme).toBeUndefined();
  });

  it("falls back to the customer's first/last name when there is no company_name", () => {
    const order = baseOrder({
      customer: { first_name: "Max", last_name: "Mustermann", email: "max@example.test" },
      billing_address: { country_code: "DE", city: "Munich", postal_code: "80331" },
    });
    const input = mapOrderToCommerceInvoiceInput(order, baseOptions());
    expect(input.buyer.name).toBe("Max Mustermann");
    expect(input.taxContext.buyerIsBusiness).toBe(false);
  });

  it("carries the street lines of the billing and shipping addresses — BT-50/51, BT-75/76 (P-60)", () => {
    const order = baseOrder({
      billing_address: {
        country_code: "de",
        city: "Munich",
        postal_code: "80331",
        address_1: "Beispielstraße 1",
        address_2: "Hinterhaus",
      },
      shipping_address: {
        country_code: "de",
        city: "Köln",
        postal_code: "50667",
        address_1: "Lagerstraße 3",
        address_2: null,
      },
    });
    const input = mapOrderToCommerceInvoiceInput(order, baseOptions());
    expect(input.buyer.addressLine1).toBe("Beispielstraße 1");
    expect(input.buyer.addressLine2).toBe("Hinterhaus");
    expect(input.delivery?.deliverToAddressLine1).toBe("Lagerstraße 3");
    expect(input.delivery?.deliverToAddressLine2).toBeUndefined();
  });

  it("names a guest buyer after the billing address, not the email (a guest has no customer name)", () => {
    const order = baseOrder({
      customer: { email: "erika@example.test" },
      billing_address: {
        country_code: "DE",
        city: "Hamburg",
        postal_code: "20095",
        first_name: "Erika",
        last_name: "Musterfrau",
      },
    });
    const input = mapOrderToCommerceInvoiceInput(order, baseOptions());
    expect(input.buyer.name).toBe("Erika Musterfrau");
  });

  it("prefers the billing address's company to the customer's own name and company", () => {
    const order = baseOrder({
      customer: { company_name: "Old Name GmbH", first_name: "Max", last_name: "Mustermann" },
      billing_address: {
        country_code: "DE",
        city: "Munich",
        postal_code: "80331",
        company: "Musterfirma GmbH",
        first_name: "Max",
        last_name: "Mustermann",
      },
    });
    const input = mapOrderToCommerceInvoiceInput(order, baseOptions());
    expect(input.buyer.name).toBe("Musterfirma GmbH");
  });

  it("names the buyer after the shipping address when the order has no billing address", () => {
    const order = baseOrder({
      customer: null,
      billing_address: null,
      shipping_address: {
        country_code: "DE",
        city: "Hamburg",
        postal_code: "20095",
        first_name: "Erika",
        last_name: "Musterfrau",
      },
    });
    const input = mapOrderToCommerceInvoiceInput(order, baseOptions());
    expect(input.buyer.name).toBe("Erika Musterfrau");
  });

  it("falls back to the order email when there is no customer name at all", () => {
    const order = baseOrder({
      customer: null,
      email: "guest@example.test",
      billing_address: { country_code: "DE", city: "Munich", postal_code: "80331" },
    });
    const input = mapOrderToCommerceInvoiceInput(order, baseOptions());
    expect(input.buyer.name).toBe("guest@example.test");
  });

  it("falls back from billing_address to shipping_address when billing has no country", () => {
    const order = baseOrder({
      billing_address: null,
      shipping_address: { country_code: "DE", city: "Hamburg", postal_code: "20095" },
    });
    const input = mapOrderToCommerceInvoiceInput(order, baseOptions());
    expect(input.buyer.city).toBe("Hamburg");
  });

  it("throws MissingBuyerCountryError when neither address carries a country_code", () => {
    const order = baseOrder({ billing_address: null, shipping_address: null });
    expect(() => mapOrderToCommerceInvoiceInput(order, baseOptions())).toThrow(
      MissingBuyerCountryError,
    );
  });

  it("reads metadata.vat_id and metadata.buyer_reference — this plugin's own documented convention", () => {
    const order = baseOrder({
      customer: {
        company_name: "Buyer GmbH",
        metadata: { vat_id: "DE999999999", buyer_reference: "2024-01" },
      },
    });
    const input = mapOrderToCommerceInvoiceInput(order, baseOptions());
    expect(input.buyer.vatIdentifier).toBe("DE999999999");
    expect(input.taxContext.buyerVatId).toBe("DE999999999");
    // A Leitweg-ID's shape, but only ever the buyer's own reference (P-54).
    expect(input.references).toEqual({ buyerReference: "2024-01" });
  });

  it("maps a declared metadata.leitweg_id to references.leitwegId, which then fills BT-10 (P-54)", () => {
    const order = baseOrder({
      customer: {
        company_name: "Stadtverwaltung Musterstadt",
        metadata: { leitweg_id: " 04011000-1234512345-06 ", buyer_reference: "PO-7" },
      },
    });
    const input = mapOrderToCommerceInvoiceInput(order, baseOptions());
    expect(input.references).toEqual({ leitwegId: "04011000-1234512345-06" });
  });

  it("reads order.metadata.regime_override — distinct from customer.metadata, a fact about this transaction", () => {
    const order = baseOrder({
      metadata: { regime_override: { kind: "reverse-charge", reasonText: "Custom reason" } },
    });
    const input = mapOrderToCommerceInvoiceInput(order, baseOptions());
    expect(input.taxContext.regimeOverride).toEqual({
      kind: "reverse-charge",
      reasonText: "Custom reason",
    });
  });

  it("leaves regimeOverride unset when order.metadata has none", () => {
    const input = mapOrderToCommerceInvoiceInput(baseOrder(), baseOptions());
    expect(input.taxContext.regimeOverride).toBeUndefined();
  });

  it("reads options.ossRegistered — a seller-level fact, not sourced from the order", () => {
    const input = mapOrderToCommerceInvoiceInput(baseOrder(), baseOptions({ ossRegistered: true }));
    expect(input.taxContext.ossRegistered).toBe(true);
  });

  it("defaults ossRegistered to false when the option is omitted", () => {
    const input = mapOrderToCommerceInvoiceInput(baseOrder(), baseOptions());
    expect(input.taxContext.ossRegistered).toBe(false);
  });

  it("reads order.metadata.oss_rate_override — a per-order fact, distinct from ossRegistered", () => {
    const order = baseOrder({ metadata: { oss_rate_override: "21" } });
    const input = mapOrderToCommerceInvoiceInput(order, baseOptions());
    expect(input.taxContext.ossRateOverride).toBe("21");
  });

  it("leaves ossRateOverride unset when order.metadata has none", () => {
    const input = mapOrderToCommerceInvoiceInput(baseOrder(), baseOptions());
    expect(input.taxContext.ossRateOverride).toBeUndefined();
  });

  it('derives supplyType per line from requires_shipping, and aggregates goods+services to "mixed"', () => {
    const order = baseOrder({
      items: [
        {
          title: "Widget",
          unit_price: 100,
          is_tax_inclusive: false,
          tax_lines: [{ rate: 19 }],
          detail: { quantity: 1 },
        },
        {
          title: "Consulting",
          unit_price: 50,
          is_tax_inclusive: false,
          tax_lines: [{ rate: 19 }],
          detail: { quantity: 1 },
          requires_shipping: false,
        },
      ],
    });
    const input = mapOrderToCommerceInvoiceInput(order, baseOptions());
    expect(input.lines[0]?.supplyType).toBe("goods");
    expect(input.lines[1]?.supplyType).toBe("services");
    expect(input.taxContext.supplyType).toBe("mixed");
  });

  it('aggregates an all-services order to supplyType "services"', () => {
    const order = baseOrder({
      items: [
        {
          title: "Consulting",
          unit_price: 50,
          is_tax_inclusive: false,
          tax_lines: [{ rate: 19 }],
          detail: { quantity: 1 },
          requires_shipping: false,
        },
      ],
    });
    const input = mapOrderToCommerceInvoiceInput(order, baseOptions());
    expect(input.taxContext.supplyType).toBe("services");
  });

  it("carries document.correctedInvoice through for a credit note", () => {
    const input = mapOrderToCommerceInvoiceInput(
      baseOrder(),
      baseOptions({
        kind: "credit-note",
        correctedInvoice: { number: "RE-2026-0001", issueDate: "2026-09-01" },
      }),
    );
    expect(input.document.kind).toBe("credit-note");
    expect(input.document.correctedInvoice).toEqual({
      number: "RE-2026-0001",
      issueDate: "2026-09-01",
    });
  });
});

describe("mapOrderToCommerceInvoiceInput — shipping and discounts (P-39)", () => {
  it("maps a line's promotion discount (Medusa's own net discount_subtotal) to a line allowance with the promotion code", () => {
    const order = baseOrder({
      items: [
        {
          title: "Widget",
          unit_price: 100,
          is_tax_inclusive: false,
          tax_lines: [{ rate: 19 }],
          detail: { quantity: 2 },
          discount_subtotal: 30,
          adjustments: [{ code: "SUMMER15" }, { code: "SUMMER15" }, { code: null }],
        },
      ],
    });
    const input = mapOrderToCommerceInvoiceInput(order, baseOptions());
    expect(input.lines[0]?.allowances).toEqual([{ amount: "30.00", reason: "SUMMER15" }]);
  });

  it("names a discount generically when Medusa carries no promotion code for it (BR-42 needs a reason)", () => {
    const order = baseOrder({
      items: [
        {
          title: "Widget",
          unit_price: 100,
          is_tax_inclusive: false,
          detail: { quantity: 1 },
          discount_subtotal: 12.345,
        },
      ],
    });
    const input = mapOrderToCommerceInvoiceInput(order, baseOptions());
    expect(input.lines[0]?.allowances).toEqual([{ amount: "12.35", reason: "Rabatt / Discount" }]);
  });

  it("leaves a line without a discount free of allowances", () => {
    const input = mapOrderToCommerceInvoiceInput(baseOrder(), baseOptions());
    expect(input.lines[0]?.allowances).toBeUndefined();
  });

  it("maps shipping methods to one document-level charge: Medusa's net subtotal minus its own net discount", () => {
    const order = baseOrder({
      shipping_methods: [
        { name: "Standard Shipping", subtotal: 10, discount_subtotal: 2.5 },
        { name: "Express surcharge", subtotal: 4.2, discount_subtotal: 0 },
      ],
    });
    const input = mapOrderToCommerceInvoiceInput(order, baseOptions());
    expect(input.shipping).toEqual({
      amount: "11.70",
      reason: "Versand / Shipping: Standard Shipping, Express surcharge",
    });
  });

  it("omits shipping entirely when it is free", () => {
    const order = baseOrder({
      shipping_methods: [{ name: "Free Shipping", subtotal: 0, discount_subtotal: 0 }],
    });
    expect(mapOrderToCommerceInvoiceInput(order, baseOptions()).shipping).toBeUndefined();
  });
});

describe("issueDateInSellerTimeZone (P-48)", () => {
  it("dates an invoice issued at 00:30 in Berlin on New Year's Day to the new year, not UTC's old one", () => {
    expect(issueDateInSellerTimeZone("DE", new Date("2026-12-31T23:30:00Z"))).toBe("2027-01-01");
  });

  it("follows Berlin's summer time (UTC+2)", () => {
    expect(issueDateInSellerTimeZone("DE", new Date("2026-06-30T22:30:00Z"))).toBe("2026-07-01");
    expect(issueDateInSellerTimeZone("DE", new Date("2026-06-30T21:30:00Z"))).toBe("2026-06-30");
  });
});
