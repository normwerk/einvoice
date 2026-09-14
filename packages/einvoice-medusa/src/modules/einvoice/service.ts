/**
 * T-070: `einvoice` module — holds the merchant-level configuration this
 * plugin needs (seller identity, default e-invoice profile), resolved from
 * `medusa-config.ts`'s `plugins: [{ resolve: "@normwerk/einvoice-medusa",
 * options: {...} }]` (verified real mechanism — Medusa's own plugin-starter
 * `src/modules/README.md`: "these options are passed to the modules within
 * the plugin"). No data model: this module holds static configuration, not
 * anything a migration needs to create a table for (T-071/T-074's own
 * modules, tracking which order already has an invoice and where its file
 * lives, are the ones that need persistence — not this one).
 *
 * Constructor signature — `(container, options)` — verified against a real
 * Medusa module provider's own compiled source
 * (`@medusajs/notification-local@2.19.0`'s `LocalNotificationService`,
 * `constructor({ logger }, options)`), not assumed from documentation.
 */
// `@normwerk/einvoice-commerce` is an ESM package ("type": "module"); this plugin's own tsconfig is
// Medusa's own CommonJS-mode convention (module: "Node16", no "type": "module" here — verified against
// two real Medusa plugins, the official create-medusa-app --plugin scaffold and @webbers/invoices-medusa,
// neither sets it). A type-only import across that boundary needs an explicit resolution-mode (TS 5.3+),
// not a real cross-module runtime concern since these are erased at compile time anyway.
import type { CommerceParty, EInvoiceProfileName } from "@normwerk/einvoice-commerce" with {
  "resolution-mode": "import",
};

export interface EinvoiceModuleOptions {
  /**
   * The merchant's own party details — every invoice this plugin builds uses this as `seller`
   * (`CommerceInvoiceInput.seller`). Includes `vatIdentifier` (BT-31); there is no separate
   * top-level "VAT-ID" field even though the task description names it alongside "seller" —
   * `CommerceParty` already carries it, and a second field would just be a second place for the
   * same fact to go stale.
   */
  readonly seller: CommerceParty;
  /**
   * Passed straight through to `selectProfile`'s own `preferredProfile` (`@normwerk/einvoice-commerce`)
   * — the merchant's preference for an ordinary B2B invoice. Never overrides a B2G buyer (a Leitweg-ID
   * buyer reference forces XRECHNUNG regardless — `selectProfile`'s own rule, not re-implemented here).
   * Defaults to `selectProfile`'s own default ("EN16931") when omitted.
   */
  readonly defaultProfile?: EInvoiceProfileName;

  // Storage config (T-074, "хранилище" in the task description) is deliberately not modeled here yet
  // — T-074 is the task that actually implements File Module storage and decides what, if anything,
  // needs to be merchant-configurable about it. Adding an undesigned field now would just be a guess.
}

export class InvalidEinvoiceModuleOptionsError extends Error {
  constructor(readonly reason: string) {
    super(`@normwerk/einvoice-medusa plugin options are invalid: ${reason}`);
    this.name = "InvalidEinvoiceModuleOptionsError";
  }
}

function assertValidOptions(options: EinvoiceModuleOptions): void {
  if (options.seller === undefined || options.seller === null) {
    throw new InvalidEinvoiceModuleOptionsError(
      "options.seller is required — every invoice this plugin builds needs a seller party " +
        "(name/countryCode/city/postCode/vatIdentifier, CommerceParty from @normwerk/einvoice-commerce).",
    );
  }
  if (!options.seller.name || options.seller.name.trim() === "") {
    throw new InvalidEinvoiceModuleOptionsError(
      "options.seller.name is required and cannot be empty.",
    );
  }
  if (!options.seller.vatIdentifier || options.seller.vatIdentifier.trim() === "") {
    // Structurally optional on CommerceParty (a buyer doesn't always have one) but not for the
    // merchant themselves — TaxContext.sellerVatId (mandatory) always needs a real value from here.
    throw new InvalidEinvoiceModuleOptionsError(
      "options.seller.vatIdentifier is required for the plugin's own seller (TaxContext.sellerVatId " +
        "has no fallback) even though CommerceParty itself leaves vatIdentifier optional for a buyer.",
    );
  }
}

/**
 * Plain config holder, resolved from the container as `EINVOICE_MODULE` (`"einvoice"`). No I/O, no
 * business logic (ADR-001/AGENTS.md §6 apply to this adapter too, not just `einvoice-commerce` itself):
 * subscribers and workflows (T-071+) read `.options` from this and call into `@normwerk/einvoice-commerce`
 * themselves — this class only validates and holds the configuration once, at container-build time,
 * rather than letting every subscriber invocation independently guess whether it's well-formed.
 */
export default class EinvoiceModuleService {
  readonly options: EinvoiceModuleOptions;

  constructor(_container: unknown, options: EinvoiceModuleOptions) {
    assertValidOptions(options);
    this.options = options;
  }
}
