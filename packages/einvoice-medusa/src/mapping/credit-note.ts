/**
 * P-41: pure decisions behind a credit note — how much of an invoice a refund or a cancellation credits,
 * and what a partial credit note contains. No tax logic: the VAT category and rate of a partial credit note
 * still come from `@normwerk/einvoice-commerce` (the caller asks it); this file only decides amounts and
 * shapes the input. Amounts are 2-decimal `Amount` strings; the arithmetic here is whole cents.
 *
 * Only type-only imports from the core packages, for the same CommonJS/ESM reason as
 * `order-to-commerce-invoice-input.ts`'s own doc comment.
 */
import type {
  AmountAtRate,
  CommerceInvoiceInput,
  ReturnToCredit,
} from "@normwerk/einvoice-commerce" with {
  "resolution-mode": "import",
};
import type { Amount, IsoDate } from "@normwerk/einvoice-model" with {
  "resolution-mode": "import",
};

function toCents(amount: Amount): number {
  const value = Number(amount);
  if (!Number.isFinite(value)) {
    throw new Error(`credit-note: "${amount}" is not an amount.`);
  }
  return Math.round(value * 100);
}

function fromCents(cents: number): Amount {
  return (cents / 100).toFixed(2);
}

/** What one refund or cancellation credits: the whole invoice restated, a gross sum, or nothing. */
export type CreditScope =
  | { readonly kind: "full" }
  | { readonly kind: "partial"; readonly gross: Amount }
  | { readonly kind: "none" };

export interface CreditScopeInput {
  /** The gross amount asked to be credited — a refund's amount, or everything outstanding on cancellation. */
  readonly requested: Amount;
  /** The original invoice's grand total (BT-112). */
  readonly invoiceTotal: Amount;
  /** Grand totals of the credit notes already issued against that invoice. */
  readonly creditedTotals: readonly Amount[];
  /** How far a refund may fall short of the invoice total and still count as all of it — per-amount
   * rounding (gross-priced shops charge a cent less or more than a net-computed invoice). */
  readonly tolerance: Amount;
}

/**
 * Never credits more than is still outstanding on the invoice: a refund larger than the rest is capped at
 * it, and a refund once the invoice is fully credited credits nothing. The whole order is restated only
 * when nothing was credited before and the refund covers the invoice; anything else is a partial credit
 * note over a gross sum. Before P-41 every refund restated the whole order, so two refunds of 10 on an
 * order of 100 produced two credit notes of 100.
 */
export function decideCreditScope(input: CreditScopeInput): CreditScope {
  const credited = input.creditedTotals.reduce((sum, total) => sum + toCents(total), 0);
  const outstanding = toCents(input.invoiceTotal) - credited;
  if (outstanding <= 0) {
    return { kind: "none" };
  }
  const credit = Math.min(toCents(input.requested), outstanding);
  if (credit <= 0) {
    return { kind: "none" };
  }
  if (input.creditedTotals.length === 0 && credit >= outstanding - toCents(input.tolerance)) {
    return { kind: "full" };
  }
  return { kind: "partial", gross: fromCents(credit) };
}

export interface CreditableRefundInput {
  /** This refund's gross amount. */
  readonly refund: Amount;
  /** Everything refunded on the order before this refund, across its payments. */
  readonly refundedBefore: Amount;
  /** Grand totals of the credit notes already issued against the invoice. */
  readonly creditedTotals: readonly Amount[];
  /** What the buyer overpaid by the invoice's notice (`InvoiceNotice.refundDue`); `"0.00"` without one. */
  readonly overpaid: Amount;
}

/**
 * P-63: the part of a refund that credits the invoice. An invoice issued with an overpayment notice
 * (`VAT_OVERCHARGED`, `mapping/charged-reconciliation.ts`) is correct as it stands: the buyer paid more than
 * its total. Returning that overpayment brings the payment down to the invoice — nothing on the invoice
 * changes, so no credit note (the notice tells the merchant to refund it). Refunds therefore return the
 * overpayment first and credit only what goes beyond it; refunds already made, less what was already
 * credited, count as returned overpayment. Without an overpayment, the whole refund is creditable.
 */
export function creditableRefund(input: CreditableRefundInput): Amount {
  const refund = toCents(input.refund);
  const credited = input.creditedTotals.reduce((sum, total) => sum + toCents(total), 0);
  const overpaid = toCents(input.overpaid);
  const returned = Math.max(0, toCents(input.refundedBefore) - credited);
  const stillOverpaid = Math.min(overpaid, Math.max(0, overpaid - returned));
  return fromCents(Math.min(refund, Math.max(0, refund - stillOverpaid)));
}

export interface PartialCreditNoteLine {
  /** The credited gross sum — passed on VAT-inclusive, so the credit note totals exactly this (P-61). */
  readonly gross: Amount;
  /** The rate facts of an order line at the rate this line credits — `buildInvoice` resolves the same rate
   * from them as it did for that line on the invoice. */
  readonly taxRateKind: "standard" | "reduced" | undefined;
  readonly chargedVatRate: Amount | undefined;
  /** T-199: the rate the invoice stated for it — the credit note credits at it. */
  readonly invoicedVatRate: Amount | undefined;
  /** What the line credits: goods returned, a partial refund, the rest of a cancelled invoice. */
  readonly label: string;
}

/**
 * A partial credit note has one line per rate and kind of credit (P-65): the credited gross amounts,
 * VAT-inclusive, under the same category as the invoice it corrects (the order's own `taxContext` is kept, so
 * `buildInvoice` decides exactly as it did for the invoice). The order's lines, shipping and discounts are
 * left out — they describe what was sold, not what is being credited.
 */
export function toPartialCreditNoteInput(
  input: CommerceInvoiceInput,
  lines: readonly PartialCreditNoteLine[],
  originalInvoiceNumber: string,
): CommerceInvoiceInput {
  const supplyType =
    input.taxContext.supplyType === "mixed" ? undefined : input.taxContext.supplyType;
  return {
    ...input,
    lines: lines.map((line, index) => ({
      identifier: String(index + 1),
      quantity: "1",
      unitCode: "C62",
      priceInclVat: line.gross,
      itemName: `${line.label} — Rechnung ${originalInvoiceNumber}`,
      taxRateKind: line.taxRateKind,
      chargedVatRate: line.chargedVatRate,
      invoicedVatRate: line.invoicedVatRate,
      supplyType,
    })),
    shipping: undefined,
    discounts: undefined,
  };
}

/** A VAT rate as a map key: "19", "19.0" and "19.00" are one rate. */
export function rateKey(rate: string): string {
  return String(Number(rate));
}

/**
 * P-65: the gross amount per VAT rate of a CII document this plugin generated itself — its BG-23 breakdown
 * (`ram:ApplicableTradeTax` at document level, the ones with a `ram:CalculatedAmount`), taxable amount plus
 * tax. What an invoice charged, or a credit note credited, at each rate.
 */
export function extractGrossByRateFromCii(xml: string): readonly AmountAtRate[] {
  const groups =
    xml.match(
      /<ram:ApplicableTradeTax>(?:(?!<\/ram:ApplicableTradeTax>)[\s\S])*<\/ram:ApplicableTradeTax>/g,
    ) ?? [];
  const byRate = new Map<string, number>();
  for (const group of groups) {
    const tax = /<ram:CalculatedAmount[^>]*>(\d+(?:\.\d+)?)<\/ram:CalculatedAmount>/.exec(group);
    const basis = /<ram:BasisAmount[^>]*>(\d+(?:\.\d+)?)<\/ram:BasisAmount>/.exec(group);
    if (tax === null || basis === null) continue;
    const rate = /<ram:RateApplicablePercent>(\d+(?:\.\d+)?)<\/ram:RateApplicablePercent>/.exec(
      group,
    );
    const key = rateKey(rate?.[1] ?? "0");
    byRate.set(
      key,
      (byRate.get(key) ?? 0) + toCents(basis[1] as string) + toCents(tax[1] as string),
    );
  }
  if (byRate.size === 0) {
    throw new Error("extractGrossByRateFromCii: no VAT breakdown (ram:ApplicableTradeTax) found.");
  }
  return [...byRate.entries()].map(([rate, cents]) => ({ rate, gross: fromCents(cents) }));
}

/** A received return of goods, as the order query returns it. */
export interface MedusaReturnForCredit {
  readonly id: string;
  readonly status?: string | null;
  /** Set only once the whole return is received; a partially received one has none. */
  readonly received_at?: string | Date | null;
  readonly created_at?: string | Date | null;
  readonly items?:
    | readonly {
        readonly item_id?: string | null;
        readonly received_quantity?: number | string | null;
      }[]
    | null;
}

/** P-65: what an invoice stated for one order line (`InvoicedLine` on the invoice document). */
export interface InvoicedLineValue {
  readonly itemId: string;
  readonly rate: string;
  readonly quantity: string;
  readonly gross: string;
  /** P-67: the line discount for these units, in the line's price basis. */
  readonly allowance?: string;
}

/**
 * P-65: each order line as the invoice states it — the Medusa line item (the invoice's lines are the
 * shipment's, in order: P-67), its rate, quantity, and net amount (BT-131) with its rate's VAT on top, and the
 * share of the line's discount it took. Stored with the invoice so a returned unit is credited at what was
 * invoiced for it, and the order's next invoice takes what is left of the discount.
 */
export function invoicedLineValues(
  items: readonly { readonly itemId: string; readonly allowance?: string }[],
  lines: readonly {
    readonly quantity: string;
    readonly netAmount: string;
    readonly vat: { readonly rate?: string | undefined };
  }[],
): readonly InvoicedLineValue[] {
  return items.flatMap((item, index) => {
    const line = lines[index];
    if (line === undefined) return [];
    const rate = rateKey(line.vat.rate ?? "0");
    const gross = Math.round((toCents(line.netAmount) * (100 + Number(rate))) / 100);
    return [
      {
        itemId: item.itemId,
        rate,
        quantity: line.quantity,
        gross: fromCents(gross),
        ...(item.allowance === undefined ? {} : { allowance: item.allowance }),
      },
    ];
  });
}

/**
 * P-65: the order's received returns — fully or partly — oldest first, with the gross value still to credit
 * at each rate: each received unit at what the invoice stated for its line (`invoiced`), less what earlier
 * credit notes paid for it (`covered`). A unit of a line the invoice does not name is not valued.
 */
export function returnsToCredit(
  returns: readonly MedusaReturnForCredit[],
  invoiced: readonly InvoicedLineValue[],
  covered: readonly { readonly returnId: string; readonly rate: string; readonly gross: Amount }[],
): readonly ReturnToCredit[] {
  const linesById = new Map(invoiced.map((line) => [line.itemId, line] as const));
  // A partially received return has no `received_at` yet; it counts from when it was created.
  const time = (r: MedusaReturnForCredit): number =>
    new Date(r.received_at ?? r.created_at ?? 0).getTime();
  const received = returns
    .filter((r) => r.status === "received" || r.status === "partially_received")
    .sort((a, b) => time(a) - time(b) || a.id.localeCompare(b.id));
  return received.flatMap((ret) => {
    const byRate = new Map<string, number>();
    for (const returned of ret.items ?? []) {
      const quantity = Number(returned.received_quantity ?? 0);
      const line = returned.item_id ? linesById.get(returned.item_id) : undefined;
      const lineQuantity = Number(line?.quantity ?? 0);
      if (quantity <= 0 || line === undefined || lineQuantity <= 0) continue;
      const rate = line.rate;
      const value = Math.round((toCents(line.gross) * quantity) / lineQuantity);
      byRate.set(rateKey(rate), (byRate.get(rateKey(rate)) ?? 0) + value);
    }
    for (const done of covered.filter((c) => c.returnId === ret.id)) {
      const key = rateKey(done.rate);
      byRate.set(key, (byRate.get(key) ?? 0) - toCents(done.gross));
    }
    const left = [...byRate.entries()].filter(([, cents]) => cents > 0);
    return left.length === 0
      ? []
      : [{ id: ret.id, byRate: left.map(([rate, cents]) => ({ rate, gross: fromCents(cents) })) }];
  });
}

/** BT-2 of a CII document this plugin generated itself — the original invoice's date for BT-26. */
export function extractIssueDateFromCii(xml: string): IsoDate {
  const match = /<ram:IssueDateTime>\s*<udt:DateTimeString[^>]*>(\d{8})<\/udt:DateTimeString>/.exec(
    xml,
  );
  if (match === null) {
    throw new Error("extractIssueDateFromCii: no ram:IssueDateTime/udt:DateTimeString found.");
  }
  const digits = match[1] as string;
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
}

/** T-199: BT-72 of a CII document this plugin generated itself — the day the supply it invoices was made, or
 * `undefined` when it states none. */
export function extractDeliveryDateFromCii(xml: string): IsoDate | undefined {
  const match =
    /<ram:ActualDeliverySupplyChainEvent>\s*<ram:OccurrenceDateTime>\s*<udt:DateTimeString[^>]*>(\d{8})<\/udt:DateTimeString>/.exec(
      xml,
    );
  const digits = match?.[1];
  return digits === undefined
    ? undefined
    : `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
}

/** BT-112 of a CII document this plugin generated itself — what an invoice or credit note amounts to. */
export function extractGrandTotalFromCii(xml: string): Amount {
  const match = /<ram:GrandTotalAmount[^>]*>(\d+(?:\.\d+)?)<\/ram:GrandTotalAmount>/.exec(xml);
  if (match === null) {
    throw new Error("extractGrandTotalFromCii: no ram:GrandTotalAmount found.");
  }
  return match[1] as string;
}

/** P-67: an invoice a refund could credit, with what it still has uncredited. */
export interface RefundCandidate {
  readonly invoiceId: string;
  readonly invoicedLines: readonly InvoicedLineValue[];
  /** Gross, less its credit notes. */
  readonly uncredited: Amount;
}

/**
 * P-67 (M-045): which invoice a refund credits, now that an order is invoiced per shipment. A refund carries
 * no goods (`refundPaymentWorkflow` records none), so:
 *
 * - one invoice with something left to credit, and every unit of the order shipped — that invoice;
 * - received returns not yet credited, all of whose goods one invoice holds — that invoice: the refund pays
 *   for those returns first (P-65);
 * - anything else — `undefined`: with several invoices, or a part paid for but not shipped, the refund may
 *   be goodwill on one invoice or money back for goods never shipped, which needs no credit note at all.
 *   The plugin does not guess; the refusal says so.
 */
export function chooseRefundInvoice(
  candidates: readonly RefundCandidate[],
  unshippedPart: boolean,
  returnedItemIds: readonly string[],
): RefundCandidate | undefined {
  const open = candidates.filter((candidate) => toCents(candidate.uncredited) > 0);
  if (open.length === 1 && !unshippedPart) return open[0];
  if (returnedItemIds.length === 0) return undefined;
  const holds = (candidate: RefundCandidate, itemId: string): boolean =>
    candidate.invoicedLines.some((line) => line.itemId === itemId);
  const holders = open.filter((candidate) => returnedItemIds.some((id) => holds(candidate, id)));
  const [only] = holders;
  return holders.length === 1 &&
    only !== undefined &&
    returnedItemIds.every((id) => holds(only, id))
    ? only
    : undefined;
}

/** P-67: the goods of received returns that no credit note has paid for yet. */
export function returnedItemIdsToCredit(
  returns: readonly MedusaReturnForCredit[],
  invoiced: readonly InvoicedLineValue[],
  covered: readonly { readonly returnId: string; readonly rate: string; readonly gross: Amount }[],
): readonly string[] {
  const open = new Set(
    returnsToCredit(returns, invoiced, covered)
      .filter((ret) => ret.byRate.some((entry) => toCents(entry.gross) > 0))
      .map((ret) => ret.id),
  );
  return [
    ...new Set(
      returns
        .filter((ret) => open.has(ret.id))
        .flatMap((ret) =>
          (ret.items ?? [])
            .filter((item) => Number(item.received_quantity ?? 0) > 0)
            .map((item) => item.item_id)
            .filter((id): id is string => typeof id === "string"),
        ),
    ),
  ];
}
