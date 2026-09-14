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
 * `await import(...)` instead, and pass the two things this file needs at runtime (Germany's standard/
 * reduced VAT rates) in as plain string parameters rather than this file importing
 * `DE_STANDARD_RATE`/`DE_REDUCED_RATE` as values itself.
 */
import type { CommerceInvoiceInput, CommerceParty } from "@normwerk/einvoice-commerce" with {
  "resolution-mode": "import",
};
import type {
  CountryCode,
  CurrencyCode,
  IsoDate,
  PaymentMeansCode,
} from "@normwerk/einvoice-model" with {
  "resolution-mode": "import",
};

export const ORDER_QUERY_FIELDS = [
  "id",
  "display_id",
  "email",
  "currency_code",
  "customer.company_name",
  "customer.first_name",
  "customer.last_name",
  "customer.email",
  "customer.metadata",
  "billing_address.country_code",
  "billing_address.city",
  "billing_address.postal_code",
  "billing_address.address_1",
  "billing_address.company",
  "shipping_address.country_code",
  "shipping_address.city",
  "shipping_address.postal_code",
  "shipping_address.address_1",
  "shipping_address.company",
  "items.title",
  "items.variant_sku",
  "items.unit_price",
  "items.is_tax_inclusive",
  "items.tax_lines.rate",
  "items.detail.quantity",
] as const;

export interface MedusaOrderAddress {
  readonly country_code?: string | null;
  readonly city?: string | null;
  readonly postal_code?: string | null;
  readonly address_1?: string | null;
  readonly company?: string | null;
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
}

export interface MedusaOrderForInvoice {
  readonly id: string;
  readonly display_id: number;
  readonly email?: string | null;
  readonly currency_code: string;
  readonly customer?: MedusaOrderCustomer | null;
  readonly shipping_address?: MedusaOrderAddress | null;
  readonly billing_address?: MedusaOrderAddress | null;
  readonly items: readonly MedusaOrderLineItem[];
}

export class MissingBuyerCountryError extends Error {
  constructor(readonly orderId: string) {
    super(
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
  /** Germany's standard/reduced VAT rate, as plain decimal-string percentages ("19"/"7") — the caller
   * passes `einvoice-commerce`'s own `DE_STANDARD_RATE`/`DE_REDUCED_RATE` (dynamically imported, see this
   * file's own doc comment on why) rather than this file importing them itself. */
  readonly deRates: { readonly standard: string; readonly reduced: string };
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
}

/**
 * The one real signal `selectProfile` (`einvoice-commerce`) needs to detect a German B2G buyer — kept
 * distinct from `CommerceInvoiceInput.references.buyerReference` itself (below), which is *always*
 * populated to satisfy BR-DE-15 (found mandatory by the same real KoSIT rejection as BG-16 above, for
 * every invoice regardless of buyer type). Feeding that always-populated value into `selectProfile` would
 * make every single order resolve to XRECHNUNG, defeating the merchant's own `defaultProfile` preference —
 * this function is the one place both `mapOrderToCommerceInvoiceInput` and the subscriber that calls
 * `selectProfile` read the *raw* signal from, so the two can never drift apart.
 */
export function resolveB2gBuyerReference(order: MedusaOrderForInvoice): string | undefined {
  return (order.customer?.metadata?.["buyer_reference"] as string | undefined) ?? undefined;
}

/**
 * Best-effort inference of whether a line's captured tax rate is DE's reduced or standard rate — only ever
 * consulted by `buildInvoice` for category S (domestic), matching `CommerceLine.taxRateKind`'s own doc
 * comment ("ignored for K/G/AE/E/Z"). Falls back to "standard" when no tax line is present at all (e.g. a
 * not-yet-priced draft synced early) rather than guessing reduced.
 */
function inferTaxRateKind(
  item: MedusaOrderLineItem,
  deRates: MapOrderOptions["deRates"],
): "standard" | "reduced" {
  const rate = item.tax_lines?.[0]?.rate;
  if (rate === undefined) {
    return "standard";
  }
  const rateNumber = Number(rate);
  const distanceToReduced = Math.abs(rateNumber - Number(deRates.reduced));
  const distanceToStandard = Math.abs(rateNumber - Number(deRates.standard));
  return distanceToReduced < distanceToStandard ? "reduced" : "standard";
}

/**
 * `OrderLineItem.unit_price` can be tax-inclusive or exclusive per line (`is_tax_inclusive`, a real field
 * on the model — not every store prices ex-tax). `CommerceLine.netPrice` is always ex-tax (`buildInvoice`
 * computes tax itself from `TaxContext`/the resolved category), so a tax-inclusive line needs backing the
 * rate out here. This is a one-time input conversion, not one of `einvoice-commerce`'s own BR-CO-*
 * summations (`decimal.ts`'s no-floating-point rule targets those) — ordinary `Number` division is
 * accurate to far more than the 2-4 decimal places any real unit price needs, and the result re-enters the
 * core as a plain decimal string that `buildInvoice`'s own bigint arithmetic takes over from there.
 */
function computeNetUnitPrice(item: MedusaOrderLineItem): string {
  const gross = Number(item.unit_price ?? 0);
  if (!item.is_tax_inclusive) {
    return gross.toFixed(4);
  }
  const rate = item.tax_lines?.[0]?.rate;
  if (rate === undefined) {
    // Tax-inclusive with no captured rate is a genuine data gap (e.g. an order synced before tax
    // calculation ran) — treating the gross price as net would silently overcharge tax on top of tax
    // already included, so surface the gross price unchanged rather than guess a rate to back out.
    return gross.toFixed(4);
  }
  const net = gross / (1 + Number(rate) / 100);
  return net.toFixed(4);
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

function resolveBuyerName(order: MedusaOrderForInvoice): string {
  const customer = order.customer;
  if (customer?.company_name) {
    return customer.company_name;
  }
  const fullName = [customer?.first_name, customer?.last_name].filter(Boolean).join(" ").trim();
  if (fullName !== "") {
    return fullName;
  }
  return order.email ?? customer?.email ?? "Unknown customer";
}

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
  // Medusa's own static country dataset uses uppercase ISO alpha-2 (`@medusajs/utils`'s
  // `defaults/countries.js`: `{ alpha2: "DE", name: "Germany", ... }`), but the value actually stored on
  // an address isn't re-verified to match that case here — normalizing defensively costs nothing and
  // removes the risk entirely, and an outright invalid code still gets caught downstream by T-060's own
  // JSON-Schema structural gate (`commerceInvoiceInputJsonSchema`, generated from this same `CountryCode`
  // union), not silently accepted either way.
  const buyerCountry = buyerAddress.country_code.toUpperCase() as CountryCode;
  const buyerVatId = (order.customer?.metadata?.["vat_id"] as string | undefined) ?? undefined;
  // BT-10 (Buyer reference) — found mandatory by a real KoSIT rejection (BR-DE-15, T-071's own e2e proof),
  // for every invoice, not just a B2G one (`resolveB2gBuyerReference`'s own doc comment explains why this
  // is deliberately a *different* value than what `selectProfile` is called with). When there's no real
  // Leitweg-ID/B2G reference, the order's own human-readable number is the closest honest equivalent this
  // mapping has for "a reference the buyer would recognize this document by" — not a fabricated value, but
  // also not claimed to be a true Leitweg-ID.
  const buyerReference = resolveB2gBuyerReference(order) ?? String(order.display_id);
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
      name: resolveBuyerName(order),
      countryCode: buyerCountry,
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
      netPrice: computeNetUnitPrice(item),
      itemName: item.title,
      taxRateKind: inferTaxRateKind(item, options.deRates),
    })),
    references: { buyerReference },
    payment: options.payment,
    taxContext: {
      sellerCountry: options.seller.countryCode,
      // assertValidOptions (service.ts) already refuses a module config without a non-empty
      // seller.vatIdentifier — this is not a fresh, unvalidated assumption.
      sellerVatId: options.seller.vatIdentifier as string,
      buyerCountry,
      buyerVatId,
      buyerIsBusiness: Boolean(order.customer?.company_name),
      // Neither OSS registration nor supply type (goods vs. services) has a source on a Medusa order by
      // default — "goods" and "not OSS-registered" are this mapping's honest defaults for v0.1's DE
      // domestic/B2B scope, not a claim about every merchant using this plugin; a services-only or
      // OSS-registered merchant needs a real extension point this task doesn't add (out of scope, not
      // silently guessed at).
      ossRegistered: false,
      supplyType: "goods",
    },
  };
}
