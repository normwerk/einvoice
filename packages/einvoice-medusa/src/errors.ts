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
  /** An unexpected error — a defect, or a failure of Medusa or a service it calls. The message says what
   * happened; retry, and report it if it persists. */
  | "INTERNAL_ERROR"
  | "UNSUPPORTED_SELLER_COUNTRY";

/** Where `code` is explained: its anchor on the error reference, in lower case with hyphens. */
export function errorDocsUrl(code: string): string {
  return `${ERROR_REFERENCE_URL}#${code.toLowerCase().replaceAll("_", "-")}`;
}

/** A new issue asking for a country, filled in beforehand — the only signal of demand the plugin sends, and
 * only when the merchant opens it. Carries the country and nothing about the order. */
export function supportRequestUrl(role: "seller" | "buyer", country: string): string {
  const title = `Support for ${role} country ${country}`;
  const body =
    `A ${role} in ${country} is not supported by @normwerk/einvoice-medusa yet. ` +
    "What would you need the invoices for that country to look like?";
  return `${NEW_ISSUE_URL}?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
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
