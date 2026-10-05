/**
 * T-077: the plugin's own errors carry a stable `code` and `docsUrl`, the same shape as
 * `@normwerk/einvoice-model`'s `EinvoiceError`. Mirrored rather than extended: this package compiles to
 * CommonJS and loads the ESM-only core packages with a dynamic `import()`, so it cannot extend their classes
 * when a module loads. `errors.test.ts` checks both build the same links.
 *
 * Every refusal the plugin records carries one of these codes, a core package's (`EinvoiceError.code`), or a
 * check's against what Medusa charged (`mapping/charged-reconciliation.ts`). The published error reference is
 * generated from the comments on the codes.
 */

/** The published error reference: one anchor per code. */
export const ERROR_REFERENCE_URL = "https://normwerk.dev/einvoice/docs/errors";

/** Where requests for another country go: a new issue in the public repository, filled in beforehand. */
const NEW_ISSUE_URL = "https://github.com/normwerk/einvoice/issues/new";

export type PluginErrorCode =
  /** The plugin options in `medusa-config.ts` are incomplete or invalid; the message names the option. The
   * plugin does not start. */
  | "INVALID_PLUGIN_OPTIONS"
  /** An option the plugin does not have, such as `integration`: the plugin issues its own invoices and does
   * not embed its XML into another plugin's PDF. Remove the option. */
  | "UNSUPPORTED_PLUGIN_OPTION"
  /** The installed Medusa release is outside the releases the plugin supports; see the compatibility table
   * of the plugin's README. The plugin does not start. */
  | "UNSUPPORTED_MEDUSA_VERSION"
  /** The order has no country on its billing or shipping address, so neither the VAT nor the document
   * profile can be decided. */
  | "MISSING_BUYER_COUNTRY"
  /** A refund or cancellation for an order whose invoice the plugin did not issue — not yet, or before the
   * plugin was installed. Issue the invoice first, then retry the credit note. */
  | "MISSING_ORIGINAL_INVOICE"
  /** A fulfillment ships an order line the order no longer states a price for — every unit of it came back
   * before the invoice was issued. Issue this invoice outside the plugin. */
  | "SHIPMENT_LINE_UNKNOWN"
  /** A fulfillment ships an item that names no order line, so the invoice cannot state it. Issue this invoice
   * outside the plugin. */
  | "SHIPMENT_ITEM_WITHOUT_LINE"
  /** A fulfillment ships the new item of an exchange. The returned item has to be reversed with it, which the
   * plugin does not do: invoice the new item, and credit the returned one, outside the plugin. */
  | "SHIPMENT_OF_EXCHANGE"
  /** A fulfillment ships a replacement from a claim. A warranty replacement needs no invoice, and VAT stated on
   * one would be owed (§14c Abs. 1 UStG). If the replacement is sold, invoice it outside the plugin. */
  | "SHIPMENT_OF_CLAIM_REPLACEMENT"
  /** A refund on an order with an exchange settles the exchange rather than reducing a price: no credit note.
   * Credit any part that does reduce a price outside the plugin. */
  | "REFUND_ON_EXCHANGE"
  /** A refund on an order with a claim with a replacement — the postage of a warranty case, for one — does not
   * reduce a price: no credit note. Credit any part that does outside the plugin. */
  | "REFUND_ON_CLAIM_REPLACEMENT"
  /** The order does not record how many units of a line a fulfillment shipped. Medusa records it with every
   * fulfillment it creates for an order; issue this invoice outside the plugin. */
  | "SHIPMENT_QUANTITY_UNKNOWN"
  /** A refund the plugin cannot tie to one invoice: the order was invoiced per shipment, or part of it is
   * paid but not shipped yet, and the refund names no goods that came back. A refund for goods never
   * shipped needs no credit note; for anything else, issue the credit note outside the plugin. */
  | "REFUND_NEEDS_MANUAL_CREDIT"
  /** A fulfillment the plugin was asked to invoice is not on the order any more. */
  | "FULFILLMENT_MISSING"
  /** An unexpected error — a defect, or a failure of Medusa or a service it calls. The message says what
   * happened; retry, and report it if it persists. */
  | "INTERNAL_ERROR"
  | "UNSUPPORTED_SELLER_COUNTRY";

/** Where `code` is explained: its anchor on the error reference, in lower case with hyphens. */
export function errorDocsUrl(code: string): string {
  return `${ERROR_REFERENCE_URL}#${code.toLowerCase().replaceAll("_", "-")}`;
}

/** The countries a support request is about: the seller's always, the buyer's when a buyer's is asked for. */
export interface SupportRequestCountries {
  readonly seller: string;
  readonly buyer?: string;
}

/**
 * A new issue asking for a country, filled in beforehand — the only signal of demand the plugin sends, and
 * only when the merchant opens it. Carries the countries and nothing about the order.
 *
 * T-209: it opens the repository's country form (`.github/ISSUE_TEMPLATE/country.yml`), which labels the issue
 * `country-request`, with the form's fields filled in by their ids; a blank issue carried no label.
 */
export function supportRequestUrl({ seller, buyer }: SupportRequestCountries): string {
  const [role, country] = buyer === undefined ? ["seller", seller] : ["buyer", buyer];
  const params = new URLSearchParams({
    template: "country.yml",
    title: `Support for ${role} country ${country}`,
    seller,
    ...(buyer === undefined ? {} : { buyer }),
    context:
      `A ${role} in ${country} is not supported by @normwerk/einvoice-medusa yet. ` +
      "What would you need the invoices for that country to look like?",
  });
  return `${NEW_ISSUE_URL}?${params.toString()}`;
}

export class PluginError extends Error {
  readonly docsUrl: string;

  constructor(
    readonly code: PluginErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "PluginError";
    this.docsUrl = errorDocsUrl(code);
  }
}

/** The code and link of any error the plugin or a core package raises; `INTERNAL_ERROR` for anything else. */
export function errorCodeOf(error: unknown): { readonly code: string; readonly docsUrl: string } {
  const { code, docsUrl } = (error ?? {}) as {
    readonly code?: unknown;
    readonly docsUrl?: unknown;
  };
  return typeof code === "string" && typeof docsUrl === "string"
    ? { code, docsUrl }
    : { code: "INTERNAL_ERROR", docsUrl: errorDocsUrl("INTERNAL_ERROR") };
}

/**
 * An error as a log line states it, ending in its code. The plugin's and the core packages' own messages name
 * ids, codes, countries and amounts only; any other error is named by its class alone, since its message
 * holds whatever its source put in it — a VAT-ID and an address from a `vatIdVerifier`, the values of a
 * failed query from the database driver (AGENTS.md §5.2).
 */
export function errorForLog(error: unknown): string {
  const { code } = errorCodeOf(error);
  if (code !== "INTERNAL_ERROR") {
    return `${error instanceof Error ? error.message : String(error)} [${code}]`;
  }
  return `an unexpected ${error instanceof Error ? error.name : typeof error} [${code}]`;
}
