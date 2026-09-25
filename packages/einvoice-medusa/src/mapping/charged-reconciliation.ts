/**
 * P-63 (M-043): the invoice's VAT (BT-110) and grand total (BT-112) against what Medusa charged. The two
 * disagree when Medusa's tax settings charged a different VAT than the invoice's category requires —
 * Medusa decides VAT at checkout from the region alone, the invoice decides it at fulfillment from the
 * buyer's VAT-ID and the destination. The comparison is asymmetric, after §14c Abs. 1 UStG: VAT an invoice
 * states is owed, whatever was charged.
 *
 * - They agree → the invoice is issued.
 * - Net prices: the invoice states less VAT than Medusa charged, and that alone explains the whole
 *   difference → the invoice is issued with a notice. The buyer paid the VAT on top and overpaid by the
 *   difference, which the merchant refunds.
 * - Gross prices: the totals agree and only the VAT differs, in either direction → the invoice is issued
 *   with a notice (P-70, M-044). The buyer paid the invoice total; the consideration is what was received
 *   less the VAT (§10 Abs. 1 UStG), so the VAT the invoice takes out of it is owed whatever Medusa computed.
 *   §14c Abs. 1 bites on VAT above what the law requires, not above Medusa's figure. Nothing to refund —
 *   only Medusa's VAT figure is wrong, and its reports with it.
 * - Anything else — with net prices the invoice states more VAT than was charged, or the totals differ for
 *   another reason (a mapping gap, prices that mix net and gross) → the invoice is not issued.
 *
 * What the buyer paid is `order.total` plus `order.credit_line_total`: Medusa subtracts credit lines from
 * the total, and they are payments, not price reductions — store credit and gift cards applied at checkout
 * (multi-purpose vouchers, §3 Abs. 15 UStG), and since `refundPaymentWorkflow` records every refund as a
 * credit line too, the sum stays what was charged after a refund. Medusa taxes credit lines at 0, so
 * `order.tax_total` needs no such correction. Checked against `@medusajs/utils@2.19.0` (`totals/cart`) and
 * `@medusajs/core-flows@2.19.0` (`refund-payment`). Credit lines are not stated on the invoice as a paid
 * amount (BT-113): the invoice states the full consideration, and a paid amount of the voucher part alone
 * would make the amount due (BT-115) wrong. P-67: the only payment stated is a full one
 * (`orderPaidInFull`).
 *
 * One cause of a lower invoice VAT is named on the notice: shipping split across the order's VAT rates
 * (a charge per rate on the invoice, M-039/P-65), where Medusa taxes shipping at one rate. It is recognised
 * from the invoice itself — document-level charges at more than one rate, which in an invoice built from a
 * Medusa order are shipping — and from Medusa's shipping VAT (`shipping_methods.tax_total`), when their
 * difference is the whole VAT difference.
 *
 * The tolerance is the invoice total check's: a cent for each independently rounded amount.
 *
 * P-69: an invoice for one fulfillment (P-67) is compared with what Medusa charged for that fulfillment —
 * its lines' units at Medusa's own per-unit amounts, and the shipping when this invoice carries it — not
 * with the order's total (`chargedForShipment`). Medusa prorates a line's totals to the units the buyer
 * still has, so a unit's amount is the line's total divided by those units: the same after a return as
 * before it, which the order's total is not.
 */
import type { Amount } from "@normwerk/einvoice-model" with {
  "resolution-mode": "import",
};
import type {
  MedusaOrderForInvoice,
  MedusaOrderLineItem,
  MedusaOrderShippingMethod,
  ShipmentScope,
} from "./order-to-commerce-invoice-input.js";

/** Whether the order's prices include VAT: every line and shipping method, none, or some. */
export type PriceBasis = "net" | "gross" | "mixed";

/** Issued, with a notice for the merchant. */
export type InvoiceNoticeCode =
  /** Issued. Prices without VAT: the invoice states less VAT than Medusa charged — typically a business
   * buyer in another EU member state, invoiced at 0 % — and the buyer paid the difference on top. Refund
   * the amount the notice names; that refund issues no credit note. */
  | "VAT_OVERCHARGED"
  /** Issued. Prices including VAT: the buyer paid the invoice total, but Medusa counts a different VAT than
   * the invoice. Nothing to refund; take VAT from the invoices, not from Medusa's order totals, and check
   * Medusa's tax rates for the order's region, products and shipping option. */
  | "VAT_DIFFERS_FROM_MEDUSA";

/** Not issued. */
export type InvoiceBlockCode =
  /** Not issued: the invoice would state more VAT than Medusa charged, and so a higher total than the
   * buyer paid — VAT stated on an invoice is owed (§14c UStG). Correct the tax rate in Medusa and the
   * order's tax lines, then retry. */
  | "INVOICE_VAT_ABOVE_CHARGED"
  /** Not issued: the invoice total does not match what Medusa charged, and a difference in VAT does not
   * explain it — or the order mixes prices with and without VAT. Correct the order and retry, or issue this
   * invoice outside the plugin. */
  | "INVOICE_TOTAL_MISMATCH"
  /** Not issued: Medusa returned no order total or VAT total to check the invoice against. */
  | "CHARGED_TOTALS_MISSING";

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

function priceBasisOf(
  items: readonly MedusaOrderLineItem[],
  shippingMethods: readonly MedusaOrderShippingMethod[],
): PriceBasis {
  const inclusive = [
    ...items.map((item) => item.is_tax_inclusive === true),
    ...shippingMethods.map((method) => method.is_tax_inclusive === true),
  ];
  if (inclusive.every(Boolean)) return "gross";
  if (inclusive.every((value) => !value)) return "net";
  return "mixed";
}

export function orderPriceBasis(order: MedusaOrderForInvoice): PriceBasis {
  return priceBasisOf(order.items, order.shipping_methods ?? []);
}

/** What Medusa charged for what a document covers, in cents — compared with the document's totals. */
export interface ChargedAmounts {
  /** VAT included — `null` when Medusa's totals do not say. */
  readonly total: number | null;
  readonly vat: number | null;
  readonly priceBasis: PriceBasis;
  /** A cent for each independently rounded amount. */
  readonly tolerance: number;
  /** The shipping methods the document carries — to recognise a shipping split as the cause. */
  readonly shippingMethods: readonly MedusaOrderShippingMethod[];
}

/** The whole order: `order.total` plus its credit lines, and `order.tax_total`. */
export function chargedForOrder(order: MedusaOrderForInvoice): ChargedAmounts {
  const shippingMethods = order.shipping_methods ?? [];
  return {
    total: present(order.total)
      ? cents(order.total) + (present(order.credit_line_total) ? cents(order.credit_line_total) : 0)
      : null,
    vat: present(order.tax_total) ? cents(order.tax_total) : null,
    priceBasis: priceBasisOf(order.items, shippingMethods),
    tolerance: order.items.length + shippingMethods.length + 1,
    shippingMethods,
  };
}

/** P-69: one fulfillment — its units at Medusa's per-unit amounts, and the shipping if it carries it. */
export function chargedForShipment(
  order: MedusaOrderForInvoice,
  shipment: ShipmentScope,
): ChargedAmounts {
  const shippingMethods = shipment.includesShipping ? (order.shipping_methods ?? []) : [];
  const items: MedusaOrderLineItem[] = [];
  let total: number | null = 0;
  let vat: number | null = 0;
  for (const line of shipment.lines) {
    const item = order.items.find((candidate) => candidate.id === line.itemId);
    const kept =
      Number(item?.detail?.quantity ?? 0) -
      Number(item?.detail?.return_received_quantity ?? 0) -
      Number(item?.detail?.return_dismissed_quantity ?? 0);
    if (item === undefined || kept <= 0 || !present(item.total) || !present(item.tax_total)) {
      total = null;
      vat = null;
      break;
    }
    items.push(item);
    total += Math.round((cents(item.total) * Number(line.quantity)) / kept);
    vat += Math.round((cents(item.tax_total) * Number(line.quantity)) / kept);
  }
  for (const method of shippingMethods) {
    if (total === null || vat === null) break;
    if (!present(method.total) || !present(method.tax_total)) {
      total = null;
      vat = null;
      break;
    }
    total += cents(method.total);
    vat += cents(method.tax_total);
  }
  return {
    total,
    vat,
    priceBasis: priceBasisOf(items, shippingMethods),
    tolerance: shipment.lines.length + shippingMethods.length + 1,
    shippingMethods,
  };
}

/** The shipping-split cause, when the invoice charges shipping at more than one rate and the difference in
 * shipping VAT is the whole VAT difference. */
function shippingSplitCause(
  shippingMethods: readonly MedusaOrderShippingMethod[],
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
  const medusaShippingVat = shippingMethods.reduce(
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
  chargedAmounts: ChargedAmounts = chargedForOrder(order),
): ChargedReconciliation {
  const invoiceTotals = invoice.totals;
  const { priceBasis, tolerance, shippingMethods } = chargedAmounts;
  const invoiced = cents(invoiceTotals.totalAmountWithVat);
  const invoicedVat = cents(invoiceTotals.totalVatAmount ?? "0");
  if (chargedAmounts.total === null || chargedAmounts.vat === null) {
    return {
      outcome: "block",
      block: {
        code: "CHARGED_TOTALS_MISSING",
        charged: chargedAmounts.total === null ? null : amount(chargedAmounts.total),
        chargedVat: chargedAmounts.vat === null ? null : amount(chargedAmounts.vat),
        invoiced: amount(invoiced),
        invoicedVat: amount(invoicedVat),
        priceBasis,
      },
    };
  }
  const charged = chargedAmounts.total;
  const chargedVat = chargedAmounts.vat;
  const comparison: ChargedComparison = {
    charged: amount(charged),
    chargedVat: amount(chargedVat),
    invoiced: amount(invoiced),
    invoicedVat: amount(invoicedVat),
    priceBasis,
  };

  const vatDifference = chargedVat - invoicedVat;
  const totalDifference = charged - invoiced;
  const within = (value: number): boolean => Math.abs(value) <= tolerance;

  if (within(vatDifference) && within(totalDifference)) {
    return { outcome: "match" };
  }
  if (priceBasis === "gross" && within(totalDifference)) {
    return {
      outcome: "notice",
      notice: {
        ...comparison,
        code: "VAT_DIFFERS_FROM_MEDUSA",
        refundDue: "0.00",
        cause: shippingSplitCause(shippingMethods, invoice, vatDifference, tolerance),
      },
    };
  }
  if (
    priceBasis === "net" &&
    vatDifference > tolerance &&
    within(totalDifference - vatDifference)
  ) {
    return {
      outcome: "notice",
      notice: {
        ...comparison,
        code: "VAT_OVERCHARGED",
        refundDue: amount(totalDifference),
        cause: shippingSplitCause(shippingMethods, invoice, vatDifference, tolerance),
      },
    };
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
      return Number(chargedVat) < Number(invoicedVat)
        ? because +
            `The buyer paid ${charged}, the e-invoice total. Medusa counts only ${chargedVat} of it as VAT, ` +
            `less than the ${invoicedVat} the e-invoice states: that VAT is owed out of what the buyer paid ` +
            "either way. Nothing to refund — take VAT from the e-invoices, not from Medusa's order totals, and " +
            "check the tax rates of this order's shipping option and region in Medusa."
        : because +
            `The buyer paid ${charged}, the e-invoice total. Medusa counts ${chargedVat} of it as VAT, the ` +
            `e-invoice ${invoicedVat}: nothing to refund, but take VAT from the e-invoices, not from Medusa's ` +
            "order totals, and check Medusa's tax settings for this region.";
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
