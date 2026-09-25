/**
 * T-071: Medusa v2 order → `CommerceInvoiceInput` (`@normwerk/einvoice-commerce`). This is the "maps
 * platform entities to CommerceInvoiceInput" half of the adapter layer (`AGENTS.md` §6's own wording for
 * this package) — no tax logic and no XML live here, only entity mapping; `decideVatCategory` and
 * `buildInvoice` (both in `einvoice-commerce`) make every tax-regime decision from the `TaxContext` this
 * file assembles, and this file never second-guesses their output.
 *
 * The field list below (`ORDER_QUERY_FIELDS`) uses plain dot-notation paths, proven for real against a
 * live `query.graph` call (a real Docker Postgres + `create-medusa-app`, this task's own e2e proof — see
 * the commit message). The admin API's own order routes (`api/admin/orders/query-config.js`,
 * `defaultAdminRetrieveOrderFields`) use a `"*relation"` wildcard-prefix form for the same relations, and
 * an earlier version of this file copied that form — but a direct `query.graph()` call from a subscriber
 * (not routed through the admin API's own field-config resolution layer) silently returns nothing for a
 * `"*relation"` entry: no error, just an order object missing every relation that used that syntax. Only
 * the explicit `relation.field` form (confirmed field-by-field against the running instance) actually
 * works from this calling context — a real, load-bearing distinction the admin route's own source doesn't
 * surface, since the two calling paths aren't the same code. `items.detail.quantity` in particular is
 * load-bearing on top of that: a Medusa order line item's own DML model (`@medusajs/order`'s
 * `OrderLineItem`) carries no `quantity` field at all — it lives on a separate, linked `OrderItem` row
 * (`detail`), the same real split T-070's research found for `display_id`-style "obvious" fields turning
 * out to need verification rather than assumption.
 *
 * Only type-only imports from `@normwerk/einvoice-commerce`/`@normwerk/einvoice-model` appear here
 * (`resolution-mode: "import"`, T-070's own cross-ESM-boundary fix) — this file never imports a runtime
 * value from either package. That's deliberate, not incidental: both are ESM-only (`"type": "module"`, no
 * `require` export condition), while this plugin compiles to CommonJS (T-070's own verified finding), so a
 * static *value* import here would compile to a `require()` that crashes at runtime
 * (`ERR_REQUIRE_ESM`) — subscribers (T-071) load `einvoice-commerce`/`einvoice-cii`'s actual functions via
 * `await import(...)` instead.
 */
import type {
  CommerceInvoiceInput,
  CommerceParty,
  RegimeOverride,
} from "@normwerk/einvoice-commerce" with {
  "resolution-mode": "import",
};
import type {
  Amount,
  CountryCode,
  CurrencyCode,
  IsoDate,
  PaymentMeansCode,
} from "@normwerk/einvoice-model" with {
  "resolution-mode": "import",
};
import { PluginError } from "../errors.js";

export const ORDER_QUERY_FIELDS = [
  "id",
  "display_id",
  "email",
  "currency_code",
  "metadata",
  "customer.company_name",
  "customer.first_name",
  "customer.last_name",
  "customer.email",
  "customer.metadata",
  "billing_address.country_code",
  "billing_address.city",
  "billing_address.postal_code",
  "billing_address.address_1",
  "billing_address.address_2",
  "billing_address.company",
  "billing_address.first_name",
  "billing_address.last_name",
  "shipping_address.country_code",
  "shipping_address.city",
  "shipping_address.postal_code",
  "shipping_address.address_1",
  "shipping_address.address_2",
  "shipping_address.company",
  "shipping_address.first_name",
  "shipping_address.last_name",
  // P-65: a return names the lines it takes back by id.
  "items.id",
  "items.title",
  "items.variant_sku",
  "items.unit_price",
  "items.is_tax_inclusive",
  "items.tax_lines.rate",
  "items.detail.quantity",
  "items.requires_shipping",
  // P-39: shipping and promotions. Requesting `total` is what makes `@medusajs/order`'s own service compute
  // order totals at all (`OrderModuleService.shouldIncludeTotals`: only when a top-level totals field is
  // selected), which is what populates the per-item and per-shipping-method `subtotal`/`discount_subtotal`
  // below — Medusa's own net amounts, so this mapping never re-derives tax-inclusive/exclusive discount
  // arithmetic itself. `total` is also read back, for `reconcileWithCharged`.
  "total",
  // P-63: what else `reconcileWithCharged` compares — the VAT Medusa charged, and the credit lines it
  // subtracted from `total` (payments, not price reductions: see that function's doc comment).
  "tax_total",
  "credit_line_total",
  "items.discount_subtotal",
  "items.discount_total",
  "items.adjustments.code",
  "shipping_methods.name",
  // P-59 (item 8): the amount every shipping total is computed from. Medusa 2.19 and later add it on their
  // own; before 2.19 a query without it returns every shipping total — and the order's `total` — as if
  // shipping were free, so the invoice left shipping out and the total check had nothing to catch.
  "shipping_methods.amount",
  "shipping_methods.is_tax_inclusive",
  "shipping_methods.total",
  "shipping_methods.subtotal",
  "shipping_methods.discount_subtotal",
  // P-63: the VAT Medusa charged on each shipping method — names the cause of a notice.
  "shipping_methods.tax_total",
] as const;

export interface MedusaOrderAddress {
  readonly country_code?: string | null;
  readonly city?: string | null;
  readonly postal_code?: string | null;
  readonly address_1?: string | null;
  readonly address_2?: string | null;
  readonly company?: string | null;
  readonly first_name?: string | null;
  readonly last_name?: string | null;
}

export interface MedusaOrderCustomer {
  readonly company_name?: string | null;
  readonly first_name?: string | null;
  readonly last_name?: string | null;
  readonly email?: string | null;
  /** No built-in Medusa field carries a VAT-ID — `metadata.vat_id` is this plugin's own documented
   * convention (`docs/domain-glossary.md`), not a platform default. */
  readonly metadata?: Record<string, unknown> | null;
}

export interface MedusaOrderLineItem {
  readonly id?: string | null;
  readonly title: string;
  readonly variant_sku?: string | null;
  /** `OrderLineItem.unit_price` — nullable in the real model (custom/free lines); treated as 0 when
   * absent rather than thrown on, since a free line is a legitimate real case (T-071 doesn't extend to
   * modeling why a caller sent a null price). */
  readonly unit_price?: number | string | null;
  readonly is_tax_inclusive: boolean;
  readonly tax_lines?: readonly { readonly rate: number | string }[];
  /** The linked `OrderItem` row — real quantity lives here, not on the line item itself (see this file's
   * own doc comment). */
  readonly detail?: { readonly quantity: number | string } | null;
  /** T-069/D-50 point 4: a real, first-class column on `@medusajs/order`'s own `OrderLineItem` model
   * (checked directly against `node_modules/@medusajs/order/dist/types/line-item.d.ts`, the same tier of
   * field as `is_tax_inclusive`/`unit_price` above — not a wildcard relation path this file's own doc
   * comment warns query.graph can silently drop). The one signal this mapping derives `supplyType` from:
   * `false` means a virtual/non-shippable line (a service), everything else (`true` or missing) is goods. */
  readonly requires_shipping?: boolean | null;
  /** P-39: the line's promotion discounts, net of tax, as Medusa's own totals computation derived them
   * (`@medusajs/utils` `getLineItemTotals`: already prorated to the current quantity and already net of tax
   * for a tax-inclusive adjustment). A `BigNumber` at runtime, read through `Number()` like `unit_price`. */
  readonly discount_subtotal?: number | string | null;
  /** P-61: the same discounts including tax — the allowance of a tax-inclusive line. */
  readonly discount_total?: number | string | null;
  /** P-39: only read for the promotion `code`s, which name the line allowance (BT-139). */
  readonly adjustments?: readonly { readonly code?: string | null }[] | null;
}

/** P-39: `OrderShippingMethod` with Medusa's own computed totals (see `ORDER_QUERY_FIELDS`). */
export interface MedusaOrderShippingMethod {
  readonly name?: string | null;
  /** P-61: whether the method's price includes tax — then its `total` is what the buyer was charged. */
  readonly is_tax_inclusive?: boolean | null;
  /** Including tax, after the method's own discounts. */
  readonly total?: number | string | null;
  /** Net of tax, before the shipping method's own discounts. */
  readonly subtotal?: number | string | null;
  /** The shipping method's own discounts, net of tax. */
  readonly discount_subtotal?: number | string | null;
  /** P-63: the VAT Medusa charged on it — at one rate, even in an order with two. */
  readonly tax_total?: number | string | null;
}

export interface MedusaOrderForInvoice {
  readonly id: string;
  readonly display_id: number;
  readonly email?: string | null;
  readonly currency_code: string;
  /** T-069/P-14: order-level facts a merchant declares explicitly, e.g. `regime_override` below — distinct
   * from `customer.metadata`, which is a fact about the *customer* and would otherwise wrongly apply to
   * every order they ever place. */
  readonly metadata?: Record<string, unknown> | null;
  readonly customer?: MedusaOrderCustomer | null;
  readonly shipping_address?: MedusaOrderAddress | null;
  readonly billing_address?: MedusaOrderAddress | null;
  readonly items: readonly MedusaOrderLineItem[];
  readonly shipping_methods?: readonly MedusaOrderShippingMethod[] | null;
  /** What Medusa charged in total, VAT included, less credit lines — compared, never copied
   * (`reconcileWithCharged`, `charged-reconciliation.ts`). */
  readonly total?: number | string | null;
  /** P-63: the VAT Medusa charged, items and shipping. */
  readonly tax_total?: number | string | null;
  /** P-63: store credit, gift cards and refunds Medusa recorded as credit lines — subtracted from `total`. */
  readonly credit_line_total?: number | string | null;
}

export class MissingBuyerCountryError extends PluginError {
  constructor(readonly orderId: string) {
    super(
      "MISSING_BUYER_COUNTRY",
      `Order ${orderId} has no billing or shipping address country_code — CommerceInvoiceInput.buyer.` +
        `countryCode/taxContext.buyerCountry have no source to map from. This is real order data missing a ` +
        `fact EN 16931 requires (BT-55/BT-40), not a mapping bug this file can paper over.`,
    );
    this.name = "MissingBuyerCountryError";
  }
}

export interface MapOrderOptions {
  readonly seller: CommerceParty;
  readonly kind: "invoice" | "credit-note";
  readonly issueDate: IsoDate;
  /** BT-25/26 — required by `buildInvoice` when `kind === "credit-note"` (T-064); the caller (the
   * `payment.refunded` subscriber) resolves which original invoice this corrects before calling here. */
  readonly correctedInvoice?: { readonly number: string; readonly issueDate: IsoDate };
  /** BG-16 (payment instructions) — merchant-level bank details (`EinvoiceModuleOptions.payment`,
   * `service.ts`), not order data: found mandatory by a real KoSIT rejection (BR-DE-1, T-071's own e2e
   * proof) regardless of which e-invoice profile `selectProfile` resolves — `buildInvoice`'s
   * `specificationIdentifier` always targets the XRechnung 3.0 CIUS (`build-invoice.ts`'s own doc comment),
   * so this is never optional the way `payment.terms`/`iban` alone would suggest. */
  readonly payment: {
    readonly means: PaymentMeansCode;
    readonly iban?: string;
    readonly terms?: string;
  };
  /** T-136/P-26: whether the merchant is OSS-registered — a standing fact about the seller, true for every
   * order they issue, not something any individual order can declare (unlike `ossRateOverride` below).
   * Threaded from `EinvoiceModuleOptions.ossRegistered` (`service.ts`), the same tier as `seller`/`payment`
   * above. Defaults to `false` when omitted, matching `taxContext.ossRegistered`'s own pre-T-136 default —
   * "not OSS-registered" stays the honest default for a merchant who never configured this. */
  readonly ossRegistered?: boolean | undefined;
}

/**
 * P-54: the buyer's Leitweg-ID, from `customer.metadata.leitweg_id` — a German public-sector buyer (B2G)
 * declared by the merchant, never inferred from the shape of another reference. `buildInvoice` validates it
 * and writes it to BT-10; `selectProfile` routes the order to XRechnung for it.
 */
function resolveLeitwegId(order: MedusaOrderForInvoice): string | undefined {
  const value = order.customer?.metadata?.["leitweg_id"];
  return typeof value === "string" ? nonEmpty(value)?.trim() : undefined;
}

/** `customer.metadata.buyer_reference` — the buyer's own reference for their invoices (BT-10), free text. */
function resolveBuyerReference(order: MedusaOrderForInvoice): string | undefined {
  const value = order.customer?.metadata?.["buyer_reference"];
  return typeof value === "string" ? nonEmpty(value) : undefined;
}

/**
 * P-50: the VAT rate Medusa charged on a line — the sum of its tax lines, as a decimal-string percentage — or
 * `undefined` when it has none. Passed on as a fact: which rate the invoice uses, and whether this one is
 * acceptable, is `buildInvoice`'s decision. This file used to snap the rate to the nearer of Germany's two,
 * which turned a line Medusa taxed at 0% into a 7% line on the invoice.
 */
function chargedVatRate(item: MedusaOrderLineItem): Amount | undefined {
  const taxLines = item.tax_lines ?? [];
  if (taxLines.length === 0) {
    return undefined;
  }
  const sum = taxLines.reduce((total, line) => total + Number(line.rate), 0);
  return sum.toFixed(4).replace(/\.?0+$/, "");
}

/**
 * P-61: a line's unit price as Medusa stores it, net or tax-inclusive (`is_tax_inclusive`, per line). A
 * tax-inclusive price is passed on as `priceInclVat`, not backed out here: `buildInvoice` takes the VAT out
 * of each rate group's gross total at the rate it decides, so the invoice totals what Medusa charged.
 */
function unitPrice(item: MedusaOrderLineItem): { netPrice?: string; priceInclVat?: string } {
  const price = Number(item.unit_price ?? 0).toFixed(4);
  return item.is_tax_inclusive ? { priceInclVat: price } : { netPrice: price };
}

/** P-48: the time zone an invoice date is read in, per seller country. v0.1 covers German sellers only
 * (`decideVatCategory` refuses any other); a seller country missing here falls back to UTC, and that
 * invoice is refused downstream anyway. */
const SELLER_TIME_ZONES: Readonly<Partial<Record<CountryCode, string>>> = { DE: "Europe/Berlin" };

/**
 * P-48: the calendar date of `instant` where the seller is — the invoice date (BT-2) a German seller would
 * write, and the year its number series belongs to. `instant.toISOString()` gives the UTC date instead:
 * wrong between midnight and 01:00 (02:00 in summer) in Berlin, and on 1 January it put the invoice into
 * the previous year's number series.
 */
export function issueDateInSellerTimeZone(sellerCountry: CountryCode, instant: Date): IsoDate {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: SELLER_TIME_ZONES[sellerCountry] ?? "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const part = (type: "year" | "month" | "day"): string =>
    parts.find((p) => p.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

/**
 * A Medusa money value (number, numeric string or `BigNumber`, all readable through `Number()`) as a
 * 2-decimal `Amount`, rounding half away from zero. This is input conversion of an amount Medusa already
 * computed — not arithmetic the invoice relies on; `buildInvoice` takes over with exact decimals from here.
 */
export function toAmount(value: number | string | null | undefined): Amount {
  const n = Number(value ?? 0);
  const rounded = (Math.sign(n) * Math.round(Math.abs(n) * 100 + 1e-9)) / 100;
  return rounded.toFixed(2);
}

/** P-39: one line allowance (BG-27) for everything Medusa discounted on this line, named after the
 * promotion code(s) it carries — BR-42 requires a reason on every line allowance. */
function resolveLineAllowances(
  item: MedusaOrderLineItem,
): readonly { readonly amount: Amount; readonly reason: string }[] | undefined {
  // P-61: in the line's own price basis — tax-inclusive for a tax-inclusive line.
  const amount = toAmount(item.is_tax_inclusive ? item.discount_total : item.discount_subtotal);
  if (Number(amount) <= 0) {
    return undefined;
  }
  const codes = [
    ...new Set(
      (item.adjustments ?? [])
        .map((adjustment) => adjustment.code)
        .filter((code): code is string => typeof code === "string" && code !== ""),
    ),
  ];
  return [{ amount, reason: codes.length > 0 ? codes.join(", ") : "Rabatt / Discount" }];
}

/** P-39: every shipping method as one document-level charge (BG-21): Medusa's net amount after its own
 * shipping discounts. Omitted when shipping is free. Its VAT rate is `buildInvoice`'s decision, not this
 * file's (P-40: the rate of the supply it belongs to). */
function resolveShipping(
  order: MedusaOrderForInvoice,
):
  | { readonly amount?: Amount; readonly amountInclVat?: Amount; readonly reason: string }
  | undefined {
  const methods = order.shipping_methods ?? [];
  // P-61: tax-inclusive methods are charged as their `total`; if every method is, the charge is passed on
  // VAT-inclusive, like a tax-inclusive line. Otherwise Medusa's net amounts, as before.
  const inclusive =
    methods.length > 0 && methods.every((method) => method.is_tax_inclusive === true);
  const sum = methods.reduce(
    (total, method) =>
      total +
      (inclusive
        ? Number(method.total ?? 0)
        : Number(method.subtotal ?? 0) - Number(method.discount_subtotal ?? 0)),
    0,
  );
  const amount = toAmount(sum);
  if (Number(amount) <= 0) {
    return undefined;
  }
  const names = methods
    .map((method) => method.name)
    .filter((name): name is string => typeof name === "string" && name !== "");
  const reason =
    names.length > 0 ? `Versand / Shipping: ${names.join(", ")}` : "Versand / Shipping";
  return inclusive ? { amountInclVat: amount, reason } : { amount, reason };
}

function resolveBuyerAddress(
  order: MedusaOrderForInvoice,
): MedusaOrderAddress & { readonly country_code: string } {
  const address = order.billing_address ?? order.shipping_address;
  if (address?.country_code === undefined || address.country_code === null) {
    throw new MissingBuyerCountryError(order.id);
  }
  return { ...address, country_code: address.country_code };
}

/**
 * BG-13 (P-25) — prefers `shipping_address` (where goods are actually dispatched to), falling back to
 * `buyerAddress` (billing, or shipping again — `resolveBuyerAddress`'s own fallback direction) the same way
 * a buyer address with no separate shipping address already does for billing purposes. Always resolves to
 * *some* address with a country code, since `resolveBuyerAddress` already guarantees one exists on this
 * same order.
 */
function resolveDeliveryAddress(
  order: MedusaOrderForInvoice,
  buyerAddress: MedusaOrderAddress & { readonly country_code: string },
): MedusaOrderAddress & { readonly country_code: string } {
  const shipping = order.shipping_address;
  if (shipping?.country_code !== undefined && shipping.country_code !== null) {
    return { ...shipping, country_code: shipping.country_code };
  }
  return buyerAddress;
}

/**
 * T-069/P-14: `order.metadata.regime_override` — this plugin's own convention (mirrors
 * `customer.metadata.vat_id`/`buyer_reference`'s existing tier, `docs/mapping-reference-medusa.md`), on
 * `order.metadata` rather than `customer.metadata` because a reverse-charge/exemption/zero-rated call is a
 * legal judgment about *this transaction*, not a standing fact about the customer that should silently
 * apply to their every future order. Medusa's `metadata` column is `jsonb` (arbitrary nested JSON, not the
 * flat string-only bag some other platforms restrict metadata to), so the value is carried straight
 * through as the same `RegimeOverride` shape `@normwerk/einvoice-commerce` already defines — no bespoke
 * re-encoding. Not runtime-validated here: a malformed value is caught downstream by `buildInvoice`'s own
 * structural gate (`validateCommerceInvoiceInput`, T-060), the same trust boundary `vat_id`/`buyer_reference`
 * already rely on.
 */
function resolveRegimeOverride(order: MedusaOrderForInvoice): RegimeOverride | undefined {
  return (order.metadata?.["regime_override"] as RegimeOverride | undefined) ?? undefined;
}

/**
 * T-136/P-26: `order.metadata.oss_rate_override` — the destination-country VAT rate for an OSS distance
 * sale (`docs/tax-semantics.md` row 7), on `order.metadata` rather than `EinvoiceModuleOptions` because,
 * unlike `ossRegistered` (a standing fact about the merchant), the rate is a fact about *this order's*
 * buyer country — the same reasoning `resolveRegimeOverride`'s own doc comment already applies to
 * `regime_override`. This package still refuses to look the rate up itself (`TaxContext.ossRateOverride`'s
 * own doc comment: no vendored EU rate table, a live and frequently-changing dataset) — the caller who
 * already computed it at checkout is the only honest source. Not runtime-validated here, the same trust
 * boundary `regime_override`/`vat_id` already rely on: a malformed value is caught downstream, either by
 * `buildInvoice`'s structural gate or, for a value that's syntactically a string but not a real rate, by
 * whichever KoSIT rule actually inspects the resulting percentage.
 */
function resolveOssRateOverride(order: MedusaOrderForInvoice): Amount | undefined {
  return (order.metadata?.["oss_rate_override"] as Amount | undefined) ?? undefined;
}

/**
 * T-069/P-16/P-20/D-50 point 4: per-line supply type derived from `requires_shipping` (this file's own
 * doc comment on `MedusaOrderLineItem.requires_shipping` has the real-field verification) — `false` means a
 * virtual/non-shippable line (a service), everything else (`true` or missing) is goods. No manual per-line
 * override field is read here on purpose: research behind D-50 found a mandatory manual field is the one
 * thing merchants reliably forget to fill in.
 */
function resolveLineSupplyType(item: MedusaOrderLineItem): "goods" | "services" {
  return item.requires_shipping === false ? "services" : "goods";
}

/**
 * Aggregates every line's derived supply type into the one whole-order `TaxContext.supplyType` value
 * `decideVatCategory` consumes today — true per-line category resolution is deliberately out of scope (see
 * `CommerceLine.supplyType`'s own doc comment); each line's own kind is still carried on
 * `CommerceLine.supplyType` (below) so that future change has a real signal to build on.
 */
function resolveOrderSupplyType(
  items: readonly MedusaOrderLineItem[],
): "goods" | "services" | "mixed" {
  const kinds = new Set(items.map(resolveLineSupplyType));
  if (kinds.size > 1) {
    return "mixed";
  }
  return kinds.has("services") ? "services" : "goods";
}

/** An optional Medusa text field as an optional model field: `null` and blank both become `undefined`. */
function nonEmpty(value: string | null | undefined): string | undefined {
  return value === null || value === undefined || value.trim() === "" ? undefined : value;
}

function fullName(person: {
  readonly first_name?: string | null;
  readonly last_name?: string | null;
}): string {
  return [person.first_name, person.last_name].filter(Boolean).join(" ").trim();
}

/**
 * BT-44. The address the invoice goes to names the buyer first: a guest checkout has no customer name at
 * all (Medusa creates the customer from the email alone), so reading only the customer record named every
 * guest after their email. The customer record is the fallback, the email the last resort.
 */
function resolveBuyerName(order: MedusaOrderForInvoice, buyerAddress: MedusaOrderAddress): string {
  const customer = order.customer;
  const candidates = [
    buyerAddress.company,
    customer?.company_name,
    fullName(buyerAddress),
    customer === null || customer === undefined ? "" : fullName(customer),
  ];
  const name = candidates.find(
    (candidate) => candidate !== null && candidate !== undefined && candidate.trim() !== "",
  );
  return name ?? order.email ?? customer?.email ?? "Unknown customer";
}

/** P-48: `document.number` of the check build a subscriber runs before it takes a real number — never on a
 * stored document. */
export const UNALLOCATED_DOCUMENT_NUMBER = "UNALLOCATED";

/**
 * Maps a Medusa order (fetched with `ORDER_QUERY_FIELDS`) plus this plugin's own seller config into a
 * `CommerceInvoiceInput` — `document.number` deliberately left unset (ADR-001/`numbering.ts`: numbering is
 * its own I/O step, `numbering-store.ts`, not entity mapping); the caller sets it after allocating one.
 */
export function mapOrderToCommerceInvoiceInput(
  order: MedusaOrderForInvoice,
  options: MapOrderOptions,
): CommerceInvoiceInput {
  const buyerAddress = resolveBuyerAddress(order);
  const deliveryAddress = resolveDeliveryAddress(order, buyerAddress);
  // Medusa's own static country dataset uses uppercase ISO alpha-2 (`@medusajs/utils`'s
  // `defaults/countries.js`: `{ alpha2: "DE", name: "Germany", ... }`), but the value actually stored on
  // an address isn't re-verified to match that case here — normalizing defensively costs nothing and
  // removes the risk entirely, and an outright invalid code still gets caught downstream by T-060's own
  // JSON-Schema structural gate (`commerceInvoiceInputJsonSchema`, generated from this same `CountryCode`
  // union), not silently accepted either way.
  const buyerCountry = buyerAddress.country_code.toUpperCase() as CountryCode;
  const buyerVatId = (order.customer?.metadata?.["vat_id"] as string | undefined) ?? undefined;
  // BT-10 (Buyer reference) — found mandatory by a real KoSIT rejection (BR-DE-15, T-071's own e2e proof),
  // for every invoice, not just a B2G one. A declared Leitweg-ID fills it; otherwise the buyer's own
  // reference, and failing that the order's own human-readable number — the closest honest equivalent this
  // mapping has for "a reference the buyer would recognize this document by", not a fabricated value.
  const leitwegId = resolveLeitwegId(order);
  const references =
    leitwegId !== undefined
      ? { leitwegId }
      : { buyerReference: resolveBuyerReference(order) ?? String(order.display_id) };
  // BT-49 (Buyer electronic address) — found mandatory by a real KoSIT rejection (BR-63, T-071's own e2e
  // proof): KoSIT bundles this into the base "EN16931 (CII)" Schematron step itself (not an
  // XRechnung-specific rule, `docs/domain-glossary.md`'s own earlier T-021 entry), so it fires
  // unconditionally, the same way `service.ts`'s seller-side check does. A plain email with EAS scheme
  // "EM" is the same convention every fixture already in this repo uses for this exact field.
  const buyerEmail = order.email ?? order.customer?.email ?? undefined;

  return {
    schemaVersion: 1,
    document: {
      kind: options.kind,
      issueDate: options.issueDate,
      currency: order.currency_code.toUpperCase() as CurrencyCode,
      correctedInvoice: options.correctedInvoice,
    },
    seller: options.seller,
    buyer: {
      name: resolveBuyerName(order, buyerAddress),
      countryCode: buyerCountry,
      addressLine1: nonEmpty(buyerAddress.address_1),
      addressLine2: nonEmpty(buyerAddress.address_2),
      city: buyerAddress.city ?? "",
      postCode: buyerAddress.postal_code ?? "",
      vatIdentifier: buyerVatId,
      electronicAddress: buyerEmail,
      electronicAddressScheme: buyerEmail === undefined ? undefined : "EM",
    },
    lines: order.items.map((item, index) => ({
      identifier: String(index + 1),
      quantity: String(item.detail?.quantity ?? 1),
      // UN/ECE Recommendation 20 "C62" (piece) — Medusa doesn't track a per-line unit-of-measure code by
      // default; a merchant that needs a different BT-130 value has no source this mapping can read yet
      // (a real, documented v0.1 gap, not an oversight).
      unitCode: "C62",
      ...unitPrice(item),
      itemName: item.title,
      chargedVatRate: chargedVatRate(item),
      supplyType: resolveLineSupplyType(item),
      allowances: resolveLineAllowances(item),
    })),
    shipping: resolveShipping(order),
    references,
    payment: options.payment,
    // BG-13 (P-25). `buildInvoice` only ever consults this for category K (BR-IC-11/12) — harmless to
    // populate unconditionally otherwise, the same way taxContext.buyerVatId is always computed regardless
    // of the category that ends up resolving. `actualDeliveryDate: options.issueDate` is a deliberate
    // simplification, not a guessed-at field: this subscriber runs in reaction to `order.fulfillment_created`
    // itself, so "today" is an honest proxy for the dispatch date — a real per-fulfillment date would need a
    // new query.graph field this task doesn't add without verifying it against a real running instance
    // first (this file's own doc comment on why an unverified field path is a real risk, not a formality).
    delivery: {
      actualDeliveryDate: options.issueDate,
      deliverToCountryCode: deliveryAddress.country_code.toUpperCase() as CountryCode,
      deliverToAddressLine1: nonEmpty(deliveryAddress.address_1),
      deliverToAddressLine2: nonEmpty(deliveryAddress.address_2),
      deliverToCity: deliveryAddress.city ?? undefined,
      deliverToPostCode: deliveryAddress.postal_code ?? undefined,
    },
    taxContext: {
      sellerCountry: options.seller.countryCode,
      // assertValidOptions (service.ts) already refuses a module config without a non-empty
      // seller.vatIdentifier — this is not a fresh, unvalidated assumption.
      sellerVatId: options.seller.vatIdentifier as string,
      buyerCountry,
      buyerVatId,
      buyerIsBusiness: Boolean(order.customer?.company_name),
      // T-136/P-26: sourced from merchant config (see MapOrderOptions.ossRegistered's own doc comment) —
      // "not OSS-registered" (the default when the merchant never set the option) stays the honest fallback
      // rather than a claim about every merchant using this plugin, the same "declared fact, never inferred"
      // shape category K's intra-eu-confirmed override and row 12's reverse-charge-cross-border already use.
      ossRegistered: options.ossRegistered ?? false,
      ossRateOverride: resolveOssRateOverride(order),
      supplyType: resolveOrderSupplyType(order.items),
      regimeOverride: resolveRegimeOverride(order),
    },
  };
}
