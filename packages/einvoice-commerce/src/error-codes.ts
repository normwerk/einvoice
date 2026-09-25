/**
 * T-077: every code `@normwerk/einvoice-commerce` raises (`EinvoiceError.code`). Stable across releases: a
 * caller branches on the code, never on the message. The published error reference is generated from the
 * comments below.
 */

/** Why `decideVatCategory`, `resolveLineRate` or `buildInvoice` refused to decide the VAT (`TaxRuleError`). */
export type TaxRuleCode =
  /** The seller is not established in Germany. The VAT rules, rates and invoice requirements this release
   * applies are German law. */
  | "UNSUPPORTED_SELLER_COUNTRY"
  /** A declared regime override does not fit the order: exempt or zero-rated for a buyer outside Germany,
   * domestic reverse charge for anything but a German business buyer, cross-border reverse charge for
   * anything but a service to a business in another EU member state. Remove the override or correct it. */
  | "OVERRIDE_OUT_OF_SCOPE"
  /** A service to a business in another EU member state. Its category (AE, reverse charge) is only applied
   * when declared: set the regime override `reverse-charge-cross-border` on the order. */
  | "CROSS_BORDER_SERVICE_UNDECLARED"
  /** An intra-EU supply needs a VAT-ID issued by another member state; the buyer's is German. */
  | "BUYER_VAT_ID_DOMESTIC"
  /** The VAT-ID the evidence or the document names is not the buyer's VAT-ID the decision was made on. */
  | "BUYER_VAT_ID_MISMATCH"
  /** An intra-EU supply (category K) needs the buyer's VAT-ID confirmed valid — a positive VIES check — or a
   * declared manual confirmation (regime override `intra-eu-confirmed`). Most often VIES was unavailable or
   * did not confirm the number: issue the invoice once it does, or declare how you confirmed it. */
  | "VAT_ID_UNVERIFIED"
  /** An intra-EU supply needs the goods delivered to another EU member state; the deliver-to country is
   * Germany, outside the EU, or missing. */
  | "DELIVERY_NOT_INTRA_EU"
  /** An export needs the goods to leave the EU; they are delivered inside it. */
  | "EXPORT_DELIVERED_IN_EU"
  /** The goods go to, or the service's buyer is in, a territory whose VAT treatment differs from its country
   * code's: Heligoland or Büsingen (DE), the Canary Islands, Ceuta or Melilla (ES), the Åland Islands (FI),
   * a French overseas department or territory, Mount Athos (GR), Livigno or Campione d'Italia (IT) — outside
   * the EU VAT area — or Northern Ireland, inside it for goods. Recognised by postcode. This release does not
   * model them; issue this invoice outside the plugin. */
  | "SPECIAL_VAT_TERRITORY"
  /** A service to a business outside the EU. Whether it is AE, O or G is not settled, and this release
   * refuses rather than guesses. Issue this invoice outside the plugin. */
  | "NON_EU_SERVICE_UNSUPPORTED"
  /** An OSS distance sale needs the destination country's VAT rate declared on the order. */
  | "OSS_RATE_MISSING"
  /** The declared OSS rate is not a VAT rate above zero. */
  | "OSS_RATE_INVALID"
  /** A service to a consumer in another EU member state under OSS. This release covers OSS sales of goods
   * only: whether a service is taxed in Germany or in the consumer's country cannot be read from the order. */
  | "OSS_SERVICES_UNSUPPORTED"
  /** An OSS order with a reduced-rate line. The declared OSS rate is one rate for the order, the
   * destination's standard rate; a reduced destination rate cannot be declared yet. */
  | "OSS_REDUCED_RATE_UNSUPPORTED"
  /** An OSS line was charged another rate than the declared destination rate. */
  | "OSS_RATE_MISMATCH"
  /** The rate a line was charged is not a VAT rate (a percentage such as `19`). */
  | "INVALID_CHARGED_RATE"
  /** A domestic line was charged a rate that is neither of Germany's (19 %, 7 %). Check the shop's tax
   * settings for the product, region and shipping option. */
  | "UNSUPPORTED_CHARGED_RATE"
  /** A domestic line is classified at one German rate but was charged the other. */
  | "CHARGED_RATE_MISMATCH"
  /** A domestic line has neither a rate classification nor a charged rate, so its rate cannot be resolved. */
  | "LINE_RATE_UNKNOWN"
  /** Shipping or a document-level discount cannot be split across the invoice's VAT rates: the lines add up
   * to zero at every rate. */
  | "CHARGE_SPLIT_IMPOSSIBLE"
  /** No rule matches the order's facts — seller, buyer country, business or consumer, OSS registration.
   * Refused rather than guessed. */
  | "NO_TAX_RULE";

/** Every code the package raises: the tax rules' and each error class's own. */
export type CommerceErrorCode =
  | TaxRuleCode
  /** A cross-border order with goods and services on one document has no single category. Issue two
   * invoices, one per kind of supply, or classify the service as part of the goods if it is ancillary to
   * them. */
  | "MIXED_SUPPLY_CROSS_BORDER"
  /** The buyer's country is not supported yet by this release. */
  | "UNSUPPORTED_BUYER_COUNTRY"
  /** The buyer's country — Italy or Poland — runs a mandatory clearance platform with its own national XML;
   * no EN 16931 document can be submitted through it. Out of scope. */
  | "UNSUPPORTED_BUYER_COUNTRY_CLEARANCE"
  /** `CommerceInvoiceInput.schemaVersion` names a version this release does not know. */
  | "UNSUPPORTED_SCHEMA_VERSION"
  /** The input fails structural validation against the `CommerceInvoiceInput` JSON Schema; the message
   * lists where. */
  | "INVALID_INPUT"
  /** A credit note must name the invoice it corrects. */
  | "MISSING_CORRECTED_INVOICE_REFERENCE"
  /** The document has no number; `buildInvoice` does not allocate one itself. */
  | "MISSING_DOCUMENT_NUMBER"
  /** An intra-EU supply needs the delivery date and the deliver-to country on the document. */
  | "MISSING_INTRA_EU_DELIVERY"
  /** An intra-EU supply needs the buyer's VAT-ID on the document itself. */
  | "MISSING_BUYER_VAT_ID"
  /** A reverse-charge supply needs the buyer's VAT-ID or legal registration identifier on the document. */
  | "MISSING_BUYER_IDENTIFIER_REVERSE_CHARGE"
  /** A service to a business in another EU member state under reverse charge needs the buyer's VAT-ID on
   * the invoice (§14a Abs. 1 UStG); a registration identifier alone is not enough. */
  | "MISSING_BUYER_VAT_ID_CROSS_BORDER_SERVICE"
  /** A line's discounts exceed its own amount. */
  | "LINE_ALLOWANCE_EXCEEDS_LINE"
  /** The declared Leitweg-ID is not valid: its format or check digits are wrong. */
  | "INVALID_LEITWEG_ID"
  /** Both a buyer reference and a Leitweg-ID were given; the invoice holds one. For a public-sector buyer,
   * give the Leitweg-ID alone. */
  | "DUPLICATE_BUYER_REFERENCE"
  /** The seller's contact — name, telephone, email — is required on every invoice (BR-DE-2). */
  | "MISSING_SELLER_CONTACT"
  /** The seller's street is required on every invoice (§14 Abs. 4 Satz 1 Nr. 1 UStG). */
  | "MISSING_SELLER_ADDRESS"
  /** The seller's or the buyer's electronic address, with its scheme, is required (an email address with
   * scheme `EM` will do). For a buyer, it is the order's email address. */
  | "MISSING_ELECTRONIC_ADDRESS"
  /** A price or charge must be given either net or including VAT — exactly one of the two. */
  | "INVALID_PRICE_BASIS"
  /** The invoice `buildInvoice` assembled fails the model's own validation — a defect in this package;
   * please report it. */
  | "INVALID_ASSEMBLED_INVOICE"
  /** A credit exceeds what is still uncredited on the invoice it corrects. */
  | "CREDIT_EXCEEDS_INVOICE"
  /** The amount stated as already paid is negative or more than the invoice total. */
  | "INVALID_PAID_AMOUNT";
