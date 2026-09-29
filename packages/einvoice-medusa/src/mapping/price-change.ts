/**
 * T-201: a price edited after the invoice was issued. Medusa lets an order edit set a line's `unit_price`
 * (`ITEM_UPDATE`, `@medusajs/order` `item-update.js`) after the goods shipped; the invoice keeps the price it
 * stated. The plugin corrects neither way — it notes the change on the invoice:
 *
 * - lowered: a refund of the difference is a price reduction, and its credit note corrects this invoice;
 * - raised: the difference is not invoiced — an additional invoice, outside the plugin.
 *
 * The notices of an invoice are worked out anew from the order's confirmed edits each time one is confirmed:
 * per line, the last price an edit confirmed after the invoice set, against the price the invoice stated
 * (`line_values[].unitPrice`). An edit back to the invoiced price takes the notice away. Pure.
 */
import type { Amount } from "@normwerk/einvoice-model" with { "resolution-mode": "import" };

/** The notice's code. */
export type PriceNoticeCode =
  /** Issued, then a price on it was changed in Medusa by an order edit. Lowered: refunding the difference
   * issues a credit note on this invoice. Raised: the difference is not invoiced — issue an additional
   * invoice outside the plugin. */
  "PRICE_CHANGED_AFTER_INVOICE";

export interface PriceNotice {
  readonly code: PriceNoticeCode;
  readonly itemId: string;
  /** The unit price the invoice stated, in the line's own price basis (net, or including VAT). */
  readonly invoicedUnitPrice: Amount;
  readonly newUnitPrice: Amount;
  readonly direction: "lowered" | "raised";
}

/** An order change as Query reads it (`order_change`): a confirmed edit and its actions. */
export interface MedusaOrderEditChange {
  readonly confirmed_at?: string | Date | null;
  readonly actions?:
    | readonly {
        readonly action?: string | null;
        readonly details?: Readonly<Record<string, unknown>> | null;
      }[]
    | null;
}

function priceCents(value: unknown): number {
  return Math.round(Number(value) * 100);
}

export function priceNotices(
  invoice: {
    readonly created_at?: string | Date | null;
    readonly line_values:
      readonly { readonly itemId: string; readonly unitPrice?: string }[] | null;
  },
  edits: readonly MedusaOrderEditChange[],
): readonly PriceNotice[] {
  const issuedAt = new Date(invoice.created_at ?? 0).getTime();
  const confirmedAt = (edit: MedusaOrderEditChange): number =>
    new Date(edit.confirmed_at ?? 0).getTime();
  const lastPrice = new Map<string, unknown>();
  for (const edit of [...edits].sort((a, b) => confirmedAt(a) - confirmedAt(b))) {
    if (edit.confirmed_at === null || edit.confirmed_at === undefined) continue;
    if (confirmedAt(edit) < issuedAt) continue;
    for (const action of edit.actions ?? []) {
      const itemId = action.details?.["reference_id"];
      const unitPrice = action.details?.["unit_price"];
      if (action.action !== "ITEM_UPDATE" || typeof itemId !== "string") continue;
      if (unitPrice === undefined || unitPrice === null) continue;
      lastPrice.set(itemId, unitPrice);
    }
  }
  return (invoice.line_values ?? []).flatMap((line) => {
    const newPrice = lastPrice.get(line.itemId);
    if (newPrice === undefined || line.unitPrice === undefined) return [];
    const invoiced = priceCents(line.unitPrice);
    const now = priceCents(newPrice);
    if (now === invoiced) return [];
    return [
      {
        code: "PRICE_CHANGED_AFTER_INVOICE" as const,
        itemId: line.itemId,
        invoicedUnitPrice: (invoiced / 100).toFixed(2),
        newUnitPrice: (now / 100).toFixed(2),
        direction: now < invoiced ? ("lowered" as const) : ("raised" as const),
      },
    ];
  });
}

/** The merchant-facing explanation — the admin widget shows it. */
export function describePriceNotice(notice: PriceNotice, itemTitle?: string): string {
  const line = itemTitle === undefined ? `line ${notice.itemId}` : `"${itemTitle}"`;
  const change = `The unit price of ${line} was ${notice.direction} from ${notice.invoicedUnitPrice} to ${notice.newUnitPrice} after this invoice was issued.`;
  return notice.direction === "lowered"
    ? `${change} Refunding the difference issues a credit note on this invoice.`
    : `${change} The difference is not invoiced: issue an additional invoice outside the plugin.`;
}
