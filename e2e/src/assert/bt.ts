/**
 * Pulls a handful of known BT (Business Term) values out of a CII XML string, by regex on the fixed
 * `ram:`-prefixed element structure — the same approach `credit-note-on-payment-refunded.ts`'s own
 * `extractIssueDateFromCii` already uses in this repo (a full XML parser would be more general, but this
 * suite only ever needs a handful of known, fixed paths out of a document another package already built
 * and validated; a real XML-conformance check is KoSIT's job, not this suite's, `assert/conformance.ts`).
 */

function requireMatch(xml: string, pattern: RegExp, label: string): string {
  const match = xml.match(pattern);
  if (match?.[1] === undefined) {
    throw new Error(`bt.ts: could not find ${label} in XML (pattern ${pattern})`);
  }
  return match[1];
}

/** BT-1: the invoice/credit-note number, `rsm:ExchangedDocument > ram:ID` (the *first* `ram:ID` in the
 * document — before any line item's own nested `ram:ID`s). */
export function invoiceNumber(xml: string): string {
  return requireMatch(
    xml,
    /<rsm:ExchangedDocument>\s*<ram:ID>([^<]+)<\/ram:ID>/,
    "BT-1 (invoice number)",
  );
}

/** BT-3: `380` (invoice) or `381` (credit note), `rsm:ExchangedDocument > ram:TypeCode`. */
export function typeCode(xml: string): string {
  return requireMatch(xml, /<ram:TypeCode>([^<]+)<\/ram:TypeCode>/, "BT-3 (type code)");
}

/** BT-112: the document grand total, `ram:SpecifiedTradeSettlementHeaderMonetarySummation >
 * ram:GrandTotalAmount` — goods, shipping and document-level charges/allowances, VAT included. */
export function grandTotalAmount(xml: string): number {
  return Number(
    requireMatch(xml, /<ram:GrandTotalAmount>([^<]+)<\/ram:GrandTotalAmount>/, "BT-112"),
  );
}

/** BT-99: the (first) document-level charge amount — this plugin puts shipping there (P-39). A charge is
 * the `ram:SpecifiedTradeAllowanceCharge` whose `ram:ChargeIndicator` is `true`. */
export function shippingChargeAmount(xml: string): number {
  return Number(
    requireMatch(
      xml,
      /<ram:SpecifiedTradeAllowanceCharge><ram:ChargeIndicator><udt:Indicator>true<\/udt:Indicator><\/ram:ChargeIndicator>(?:(?!<\/ram:SpecifiedTradeAllowanceCharge>).)*?<ram:ActualAmount>([^<]+)<\/ram:ActualAmount>/,
      "BT-99 (document-level charge amount)",
    ),
  );
}

/** BT-118: the (first) VAT category code on the invoice — `S`/`K`/`G`/`AE`/`E`/`Z` per
 * `docs/tax-semantics.md`. A single-category order (every S1/S2/S4 scenario) has exactly one distinct
 * value across every `ram:CategoryCode` in the document; this returns the first. */
export function vatCategoryCode(xml: string): string {
  return requireMatch(
    xml,
    /<ram:CategoryCode>([^<]+)<\/ram:CategoryCode>/,
    "BT-118 (VAT category)",
  );
}

/** BT-48: the buyer's VAT-ID, `ram:BuyerTradeParty > ram:SpecifiedTaxRegistration > ram:ID`. */
export function buyerVatId(xml: string): string | undefined {
  const match = xml.match(
    /<ram:BuyerTradeParty>[\s\S]*?<ram:SpecifiedTaxRegistration>\s*<ram:ID[^>]*>([^<]+)<\/ram:ID>/,
  );
  return match?.[1];
}

/** BT-25: the corrected (original) invoice number a credit note references,
 * `ram:InvoiceReferencedDocument > ram:IssuerAssignedID`. */
export function correctedInvoiceNumber(xml: string): string | undefined {
  const match = xml.match(
    /<ram:InvoiceReferencedDocument>\s*<ram:IssuerAssignedID>([^<]+)<\/ram:IssuerAssignedID>/,
  );
  return match?.[1];
}

/** BG-25: how many invoice lines the document has (`ram:IncludedSupplyChainTradeLineItem`). */
export function lineCount(xml: string): number {
  return xml.match(/<ram:IncludedSupplyChainTradeLineItem>/g)?.length ?? 0;
}
