/**
 * T-065/W9: which e-invoice profile to embed the document under, by buyer
 * country and settings.
 *
 * `EInvoiceProfileName`'s two values are the same strings
 * `@normwerk/einvoice-pdfa`'s `ZugferdProfileName` uses (`profiles.ts`) —
 * kept as a plain literal type here rather than importing that package, to
 * avoid a layer-violating dependency from this pure business-logic package
 * onto the PDF-assembly one (ADR-001: `einvoice-commerce` doesn't know PDF
 * exists). Whatever calls both packages (an adapter, or a standalone
 * script) passes this value straight through.
 *
 * Scope: Germany only (v0.1). `docs/adr's` own plan text: "DK/NO/SE → Peppol
 * BIS в v0.2" — a non-DE buyer country throws rather than silently picking
 * a ZUGFeRD/XRechnung profile that was never validated against that
 * country's actual e-invoicing mandate.
 */
import type { CountryCode } from "@normwerk/einvoice-model";

export type EInvoiceProfileName = "EN16931" | "XRECHNUNG";

export class UnsupportedCountryError extends Error {
  constructor(readonly countryCode: CountryCode) {
    super(
      `selectProfile: buyer country "${countryCode}" is not yet supported — v0.1 targets Germany only ` +
        `(STRATEGY.md §2); DK/NO/SE Peppol BIS support is deferred to v0.2 (plan-v0.1 §4.4/T-065).`,
    );
    this.name = "UnsupportedCountryError";
  }
}

export interface SelectProfileOptions {
  readonly buyerCountry: CountryCode;
  /** Presence signals a German public-sector buyer (B2G) — XRechnung's pure-XML delivery is mandatory
   * there; a plain ZUGFeRD/Factur-X hybrid PDF is not an accepted substitute (unlike ordinary B2B). */
  readonly buyerReference?: string;
  /** Caller's own preference, when neither B2G-mandatory-XRechnung nor the plain default applies. */
  readonly preferredProfile?: EInvoiceProfileName;
}

export function selectProfile(options: SelectProfileOptions): EInvoiceProfileName {
  if (options.buyerCountry !== "DE") {
    throw new UnsupportedCountryError(options.buyerCountry);
  }
  if (options.buyerReference !== undefined) {
    return "XRECHNUNG";
  }
  return options.preferredProfile ?? "EN16931";
}
