/**
 * P-41: pure decisions behind a credit note — how much of an invoice a refund or a cancellation credits,
 * and what a partial credit note contains. No tax logic: the VAT category and rate of a partial credit note
 * still come from `@normwerk/einvoice-commerce` (the caller asks it); this file only decides amounts and
 * shapes the input. Amounts are 2-decimal `Amount` strings; the arithmetic here is whole cents.
 *
 * Only type-only imports from the core packages, for the same CommonJS/ESM reason as
 * `order-to-commerce-invoice-input.ts`'s own doc comment.
 */
import type { CommerceInvoiceInput } from "@normwerk/einvoice-commerce" with {
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
  /** The rate facts every line of the order shares (a partial credit note over mixed rates is refused). */
  readonly taxRateKind: "standard" | "reduced" | undefined;
  readonly chargedVatRate: Amount | undefined;
  readonly originalInvoiceNumber: string;
  /** Names the line: a partial refund, or the rest of an invoice cancelled after part of it was credited. */
  readonly reason?: "refund" | "cancellation";
}

/**
 * A partial credit note has one line: the credited gross amount, VAT-inclusive, under the same category and
 * rate as the invoice it corrects (the order's own `taxContext` is kept, so `buildInvoice` decides exactly as it did
 * for the invoice). The order's lines, shipping and discounts are left out — they describe what was sold,
 * not what is being credited.
 */
export function toPartialCreditNoteInput(
  input: CommerceInvoiceInput,
  line: PartialCreditNoteLine,
): CommerceInvoiceInput {
  const label =
    line.reason === "cancellation"
      ? "Stornierung Restbetrag / Cancellation of the remaining amount"
      : "Teilerstattung / Partial refund";
  const supplyType =
    input.taxContext.supplyType === "mixed" ? undefined : input.taxContext.supplyType;
  return {
    ...input,
    lines: [
      {
        identifier: "1",
        quantity: "1",
        unitCode: "C62",
        priceInclVat: line.gross,
        itemName: `${label} — Rechnung ${line.originalInvoiceNumber}`,
        taxRateKind: line.taxRateKind,
        chargedVatRate: line.chargedVatRate,
        supplyType,
      },
    ],
    shipping: undefined,
    discounts: undefined,
  };
}

export class PartialCreditAcrossRatesError extends Error {
  constructor(readonly orderId: string) {
    super(
      `Order ${orderId}: a partial credit note for an order whose lines carry different VAT rates needs a ` +
        "rule for splitting the credited amount across those rates, and none is decided yet. Issue this " +
        "credit note yourself; a full refund or cancellation is still credited automatically.",
    );
    this.name = "PartialCreditAcrossRatesError";
  }
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

/** BT-112 of a CII document this plugin generated itself — what an invoice or credit note amounts to. */
export function extractGrandTotalFromCii(xml: string): Amount {
  const match = /<ram:GrandTotalAmount[^>]*>(\d+(?:\.\d+)?)<\/ram:GrandTotalAmount>/.exec(xml);
  if (match === null) {
    throw new Error("extractGrandTotalFromCii: no ram:GrandTotalAmount found.");
  }
  return match[1] as string;
}
