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

/** BT-110: the invoice's total VAT, `ram:TaxTotalAmount` (in the document currency). */
export function taxTotalAmount(xml: string): number {
  return Number(
    requireMatch(xml, /<ram:TaxTotalAmount[^>]*>([^<]+)<\/ram:TaxTotalAmount>/, "BT-110"),
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

/** BT-2: the issue date, `rsm:ExchangedDocument > ram:IssueDateTime`, as `YYYY-MM-DD`. */
export function issueDate(xml: string): string {
  const digits = requireMatch(
    xml,
    /<ram:IssueDateTime>\s*<udt:DateTimeString[^>]*>(\d{8})<\/udt:DateTimeString>/,
    "BT-2 (issue date)",
  );
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
}

/** BT-10: the buyer reference, `ram:ApplicableHeaderTradeAgreement > ram:BuyerReference`. */
export function buyerReference(xml: string): string {
  return requireMatch(xml, /<ram:BuyerReference>([^<]+)<\/ram:BuyerReference>/, "BT-10");
}

/** BT-44: the buyer's name, `ram:BuyerTradeParty > ram:Name`. */
export function buyerName(xml: string): string {
  return requireMatch(xml, /<ram:BuyerTradeParty>\s*<ram:Name>([^<]+)<\/ram:Name>/, "BT-44");
}

/** BG-27: every line-level allowance, as `{ amount, reason }` (BT-136, BT-139) — an allowance is a
 * line's `ram:SpecifiedTradeAllowanceCharge` whose `ram:ChargeIndicator` is `false`. */
export function lineAllowances(xml: string): readonly { amount: number; reason: string }[] {
  const lines =
    xml.match(
      /<ram:IncludedSupplyChainTradeLineItem>[\s\S]*?<\/ram:IncludedSupplyChainTradeLineItem>/g,
    ) ?? [];
  return lines.flatMap((line) =>
    [
      ...line.matchAll(
        /<ram:SpecifiedTradeAllowanceCharge><ram:ChargeIndicator><udt:Indicator>false<\/udt:Indicator><\/ram:ChargeIndicator>(?:(?!<\/ram:SpecifiedTradeAllowanceCharge>).)*?<ram:ActualAmount>([^<]+)<\/ram:ActualAmount>(?:(?!<\/ram:SpecifiedTradeAllowanceCharge>).)*?<ram:Reason>([^<]+)<\/ram:Reason>/g,
      ),
    ].map((match) => ({ amount: Number(match[1]), reason: match[2] as string })),
  );
}

/** BT-35 (seller) / BT-50 (buyer): a party's first address line, `ram:PostalTradeAddress > ram:LineOne`. */
export function addressLineOne(
  xml: string,
  party: "SellerTradeParty" | "BuyerTradeParty",
): string | undefined {
  const start = xml.indexOf(`<ram:${party}>`);
  const end = xml.indexOf(`</ram:${party}>`, start);
  return xml
    .slice(start, end)
    .match(/<ram:PostalTradeAddress>[\s\S]*?<ram:LineOne>([^<]+)<\/ram:LineOne>/)?.[1];
}

/** P-65: every document-level charge (BG-21) — amount (BT-99), rate (BT-103) and reason (BT-104). */
export function documentCharges(
  xml: string,
): readonly { readonly amount: number; readonly rate: string; readonly reason: string }[] {
  const blocks =
    xml.match(
      /<ram:SpecifiedTradeAllowanceCharge><ram:ChargeIndicator><udt:Indicator>true<\/udt:Indicator>(?:(?!<\/ram:SpecifiedTradeAllowanceCharge>).)*<\/ram:SpecifiedTradeAllowanceCharge>/g,
    ) ?? [];
  return blocks.map((block) => ({
    amount: Number(/<ram:ActualAmount>([^<]+)<\/ram:ActualAmount>/.exec(block)?.[1]),
    rate: /<ram:RateApplicablePercent>([^<]+)<\/ram:RateApplicablePercent>/.exec(block)?.[1] ?? "",
    reason: /<ram:Reason>([^<]*)<\/ram:Reason>/.exec(block)?.[1] ?? "",
  }));
}

/** P-65: the gross amount per VAT rate — the document-level BG-23 groups, taxable amount plus tax. */
export function grossByRate(xml: string): Readonly<Record<string, number>> {
  const groups =
    xml.match(
      /<ram:ApplicableTradeTax><ram:CalculatedAmount>(?:(?!<\/ram:ApplicableTradeTax>).)*<\/ram:ApplicableTradeTax>/g,
    ) ?? [];
  return Object.fromEntries(
    groups.map((group) => {
      const tax = Number(/<ram:CalculatedAmount>([^<]+)</.exec(group)?.[1]);
      const basis = Number(/<ram:BasisAmount>([^<]+)</.exec(group)?.[1]);
      const rate = String(Number(/<ram:RateApplicablePercent>([^<]+)</.exec(group)?.[1] ?? "0"));
      return [rate, Math.round((tax + basis) * 100) / 100];
    }),
  );
}

/** P-65: every line's item name (BT-153). */
export function lineNames(xml: string): readonly string[] {
  return [
    ...xml.matchAll(
      /<ram:SpecifiedTradeProduct>(?:(?!<\/ram:SpecifiedTradeProduct>).)*?<ram:Name>([^<]*)<\/ram:Name>/g,
    ),
  ].map((match) => match[1] as string);
}

/** P-67: BT-113, what the buyer already paid — `ram:TotalPrepaidAmount`; `undefined` when not stated. */
export function paidAmount(xml: string): number | undefined {
  const match = /<ram:TotalPrepaidAmount>([^<]+)<\/ram:TotalPrepaidAmount>/.exec(xml);
  return match === null ? undefined : Number(match[1]);
}

/** P-67: BT-115, the amount due — `ram:DuePayableAmount`. */
export function duePayableAmount(xml: string): number {
  return Number(
    requireMatch(xml, /<ram:DuePayableAmount>([^<]+)<\/ram:DuePayableAmount>/, "BT-115"),
  );
}

/** P-67: BT-72, the actual delivery date — `ram:ActualDeliverySupplyChainEvent`, as `YYYY-MM-DD`. */
export function deliveryDate(xml: string): string {
  const digits = requireMatch(
    xml,
    /<ram:ActualDeliverySupplyChainEvent>\s*<ram:OccurrenceDateTime>\s*<udt:DateTimeString[^>]*>(\d{8})<\/udt:DateTimeString>/,
    "BT-72 (delivery date)",
  );
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
}
