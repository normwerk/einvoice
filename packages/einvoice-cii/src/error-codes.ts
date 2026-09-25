/**
 * T-077: every code `@normwerk/einvoice-cii` raises (`EinvoiceError.code`). Stable across releases; the
 * published error reference is generated from the comments below.
 */
export type CiiErrorCode =
  /** The invoice carries a field the CII serialization does not write yet (listed in the message). It is
   * refused rather than dropped from the XML without a trace. Leave the field out, or map it only once a
   * release writes it — see the mapping reference for the fields it writes. */
  | "UNMAPPED_INVOICE_FIELDS"
  /** A value — a product name, an address — contains a control character that XML 1.0 cannot carry, not
   * even escaped; the document would not parse. Remove the character from the source data. */
  | "UNREPRESENTABLE_CHARACTER";
