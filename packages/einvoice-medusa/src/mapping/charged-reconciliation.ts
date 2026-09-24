/**
 * P-63 (M-043): the invoice's VAT (BT-110) and grand total (BT-112) against what Medusa charged. The two
 * disagree when Medusa's tax settings charged a different VAT than the invoice's category requires —
 * Medusa decides VAT at checkout from the region alone, the invoice decides it at fulfillment from the
 * buyer's VAT-ID and the destination. The comparison is asymmetric, after §14c Abs. 1 UStG: VAT an invoice
 * states is owed, whatever was charged.
 *
 * - They agree → the invoice is issued.
 * - The invoice states less VAT than Medusa charged, and that alone explains the whole difference → the
 *   invoice is issued with a notice. Net prices: the buyer paid the VAT on top and overpaid by the
 *   difference, which the merchant refunds. Gross prices: the buyer paid the invoice total, and only
 *   Medusa's VAT figure differs.
 * - Anything else — the invoice states more VAT than was charged, or the totals differ for another reason
 *   (a mapping gap, prices that mix net and gross) → the invoice is not issued.
 *
 * What the buyer paid is `order.total` plus `order.credit_line_total`: Medusa subtracts credit lines from
 * the total, and they are payments, not price reductions — store credit and gift cards applied at checkout
 * (multi-purpose vouchers, §3 Abs. 15 UStG), and since `refundPaymentWorkflow` records every refund as a
 * credit line too, the sum stays what was charged after a refund. Medusa taxes credit lines at 0, so
 * `order.tax_total` needs no such correction. Checked against `@medusajs/utils@2.19.0` (`totals/cart`) and
 * `@medusajs/core-flows@2.19.0` (`refund-payment`). Credit lines are not stated on the invoice as a paid
 * amount (BT-113): the invoice states the full consideration and no payment at all, card payments
 * included, and a paid amount of the voucher part alone would make the amount due (BT-115) wrong.
 *
 * One cause of a lower invoice VAT is named on the notice: shipping split across the order's VAT rates
 * (a charge per rate on the invoice, M-039/P-65), where Medusa taxes shipping at one rate. It is recognised
 * from the invoice itself — document-level charges at more than one rate, which in an invoice built from a
 * Medusa order are shipping — and from Medusa's shipping VAT (`shipping_methods.tax_total`), when their
 * difference is the whole VAT difference.
 *
 * The tolerance is the invoice total check's: a cent for each independently rounded amount.
 */
import type { Amount } from "@normwerk/einvoice-model" with {
  "resolution-mode": "import",
};
import type { MedusaOrderForInvoice } from "./order-to-commerce-invoice-input.js";

/** Whether the order's prices include VAT: every line and shipping method, none, or some. */
export type PriceBasis = "net" | "gross" | "mixed";

/** Issued, with a notice for the merchant. */
export type InvoiceNoticeCode = "VAT_OVERCHARGED" | "VAT_DIFFERS_FROM_MEDUSA";

/** Not issued. */
export type InvoiceBlockCode =
  "INVOICE_VAT_ABOVE_CHARGED" | "INVOICE_TOTAL_MISMATCH" | "CHARGED_TOTALS_MISSING";

/** The amounts compared — stored with a notice or a block, and shown to the merchant. */
export interface ChargedComparison {
  /** What the buyer paid, VAT included: `order.total + order.credit_line_total`. `null` when Medusa
   * returned no total. */
  readonly charged: Amount | null;
  /** The VAT Medusa charged, `order.tax_total`. `null` when Medusa returned none. */
  readonly chargedVat: Amount | null;
  /** BT-112. */
  readonly invoiced: Amount;
  /** BT-110. */
  readonly invoicedVat: Amount;
  readonly priceBasis: PriceBasis;
}

/** Why the invoice states less VAT than Medusa charged, when the plugin can tell. */
export type InvoiceNoticeCause = "shipping-split-across-rates";

export interface InvoiceNotice extends ChargedComparison {
  readonly code: InvoiceNoticeCode;
  /** What the buyer overpaid and the merchant refunds — `"0.00"` for gross prices. */
  readonly refundDue: Amount;
  readonly cause: InvoiceNoticeCause | null;
}

export interface InvoiceBlock extends ChargedComparison {
  readonly code: InvoiceBlockCode;
}

export type ChargedReconciliation =
  | { readonly outcome: "match" }
  | { readonly outcome: "notice"; readonly notice: InvoiceNotice }
  | { readonly outcome: "block"; readonly block: InvoiceBlock };

/** What the check reads of the invoice `buildInvoice` returns: its totals and its document-level charges. */
export interface InvoiceForReconciliation {
  readonly totals: {
    readonly totalAmountWithVat: Amount;
    readonly totalVatAmount?: Amount | undefined;
  };
  readonly documentLevelCharges?:
    readonly { readonly amount: Amount; readonly vatRate?: Amount | undefined }[] | undefined;
}

function cents(value: number | string): number {
  return Math.round(Number(value) * 100);
}

function amount(valueInCents: number): Amount {
  return (valueInCents / 100).toFixed(2);
}

function present(value: number | string | null | undefined): value is number | string {
  return value !== null && value !== undefined && Number.isFinite(Number(value));
}

export function orderPriceBasis(order: MedusaOrderForInvoice): PriceBasis {
  const inclusive = [
    ...order.items.map((item) => item.is_tax_inclusive === true),
    ...(order.shipping_methods ?? []).map((method) => method.is_tax_inclusive === true),
  ];
  if (inclusive.every(Boolean)) return "gross";
  if (inclusive.every((value) => !value)) return "net";
  return "mixed";
}

/** The shipping-split cause, when the invoice charges shipping at more than one rate and the difference in
 * shipping VAT is the whole VAT difference. */
function shippingSplitCause(
  order: MedusaOrderForInvoice,
  invoice: InvoiceForReconciliation,
  vatDifference: number,
  tolerance: number,
): InvoiceNoticeCause | null {
  const charges = invoice.documentLevelCharges ?? [];
  if (new Set(charges.map((charge) => Number(charge.vatRate ?? 0))).size < 2) {
    return null;
  }
  const invoiceShippingVat = charges.reduce(
    (sum, charge) => sum + Math.round((cents(charge.amount) * Number(charge.vatRate ?? 0)) / 100),
    0,
  );
  const medusaShippingVat = (order.shipping_methods ?? []).reduce(
    (sum, method) => sum + (present(method.tax_total) ? cents(method.tax_total) : 0),
    0,
  );
  return Math.abs(medusaShippingVat - invoiceShippingVat - vatDifference) <= tolerance
    ? "shipping-split-across-rates"
    : null;
}

export function reconcileWithCharged(
  order: MedusaOrderForInvoice,
  invoice: InvoiceForReconciliation,
): ChargedReconciliation {
  const invoiceTotals = invoice.totals;
  const priceBasis = orderPriceBasis(order);
  const invoiced = cents(invoiceTotals.totalAmountWithVat);
  const invoicedVat = cents(invoiceTotals.totalVatAmount ?? "0");
  if (!present(order.total) || !present(order.tax_total)) {
    return {
      outcome: "block",
      block: {
        code: "CHARGED_TOTALS_MISSING",
        charged: present(order.total) ? amount(cents(order.total)) : null,
        chargedVat: present(order.tax_total) ? amount(cents(order.tax_total)) : null,
        invoiced: amount(invoiced),
        invoicedVat: amount(invoicedVat),
        priceBasis,
      },
    };
  }
  const charged =
    cents(order.total) + (present(order.credit_line_total) ? cents(order.credit_line_total) : 0);
  const chargedVat = cents(order.tax_total);
  const comparison: ChargedComparison = {
    charged: amount(charged),
    chargedVat: amount(chargedVat),
    invoiced: amount(invoiced),
    invoicedVat: amount(invoicedVat),
    priceBasis,
  };

  const tolerance = order.items.length + (order.shipping_methods?.length ?? 0) + 1;
  const vatDifference = chargedVat - invoicedVat;
  const totalDifference = charged - invoiced;
  const within = (value: number): boolean => Math.abs(value) <= tolerance;

  if (within(vatDifference) && within(totalDifference)) {
    return { outcome: "match" };
  }
  if (vatDifference > tolerance) {
    const cause = shippingSplitCause(order, invoice, vatDifference, tolerance);
    if (priceBasis === "net" && within(totalDifference - vatDifference)) {
      return {
        outcome: "notice",
        notice: {
          ...comparison,
          code: "VAT_OVERCHARGED",
          refundDue: amount(totalDifference),
          cause,
        },
      };
    }
    if (priceBasis === "gross" && within(totalDifference)) {
      return {
        outcome: "notice",
        notice: { ...comparison, code: "VAT_DIFFERS_FROM_MEDUSA", refundDue: "0.00", cause },
      };
    }
  }
  return {
    outcome: "block",
    block: {
      ...comparison,
      code: vatDifference < -tolerance ? "INVOICE_VAT_ABOVE_CHARGED" : "INVOICE_TOTAL_MISMATCH",
    },
  };
}

/** The merchant-facing explanation of a notice or a block — the admin widget and the log both show it. */
export function describeChargedReconciliation(result: InvoiceNotice | InvoiceBlock): string {
  const { charged, chargedVat, invoiced, invoicedVat } = result;
  const because =
    "cause" in result && result.cause === "shipping-split-across-rates"
      ? "The e-invoice splits shipping across the order's VAT rates; Medusa taxes it at one rate. "
      : "";
  switch (result.code) {
    case "VAT_OVERCHARGED":
      return (
        because +
        `Medusa charged ${charged} including ${chargedVat} VAT; the e-invoice states ${invoiced} ` +
        `including ${invoicedVat} VAT. The buyer overpaid ${result.refundDue} — refund ` +
        "them the difference. A refund of up to that amount issues no credit note: the e-invoice is correct."
      );
    case "VAT_DIFFERS_FROM_MEDUSA":
      return (
        because +
        `The buyer paid ${charged}, the e-invoice total. Medusa counts ${chargedVat} of it as VAT, the ` +
        `e-invoice ${invoicedVat}: nothing to refund, but take VAT from the e-invoices, not from Medusa's ` +
        "order totals, and check Medusa's tax settings for this region."
      );
    case "INVOICE_VAT_ABOVE_CHARGED":
      return (
        `Not issued: the e-invoice would state ${invoicedVat} VAT (total ${invoiced}), more than the ` +
        `${chargedVat} VAT Medusa charged (total ${charged}) — VAT stated on an invoice is owed ` +
        "(§14c UStG). Check Medusa's tax settings for this order's region, products and shipping option, " +
        "correct the order, and issue it again; if the order cannot be corrected, issue this invoice " +
        "outside the plugin."
      );
    case "INVOICE_TOTAL_MISMATCH":
      return (
        `Not issued: the e-invoice total ${invoiced} (VAT ${invoicedVat}) does not match what Medusa ` +
        `charged, ${charged} (VAT ${chargedVat}), and a difference in VAT does not explain it` +
        (result.priceBasis === "mixed"
          ? " — the order mixes prices with and without VAT, which this check cannot reconcile. "
          : ". ") +
        "Correct the order and issue it again, or issue this invoice outside the plugin."
      );
    case "CHARGED_TOTALS_MISSING":
      return (
        "Not issued: Medusa returned no order total or VAT total to check the e-invoice " +
        `(total ${invoiced}, VAT ${invoicedVat}) against.`
      );
  }
}
