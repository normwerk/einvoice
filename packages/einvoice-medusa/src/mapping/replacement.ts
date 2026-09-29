/**
 * T-201: exchanges and warranty replacements, which the plugin does not document — a visible refusal instead
 * of a wrong document.
 *
 * Medusa marks neither on the line: an exchange's new item is an `order_exchange_item` row (`item_id` the
 * order line), a claim's replacement an `order_claim_item` row with `is_additional_item = true` (its
 * `claim_items` — what the buyer claims for — share the table without the flag). The order has no relation to
 * either; they are read through Query as `order_exchange` and `order_claim`, by `order_id`.
 *
 * - A shipment of a replacement would get an ordinary invoice at the catalogue price Medusa puts on the new
 *   line: a warranty replacement needs no invoice, and VAT stated on one is owed (§14c Abs. 1 UStG); an
 *   exchange's new item needs the returned one reversed with it. Refused — a shipment mixing original lines
 *   and a replacement too, as a whole.
 * - A refund on an order with an exchange or a claim with a replacement may settle the exchange or refund
 *   the postage of a warranty case (§439 Abs. 2 BGB) — neither a price reduction a credit note corrects.
 *   Refused. A claim without a replacement — money back for a defect — is credited as before.
 *
 * A cancelled exchange or claim counts for nothing. Pure: the caller reads the rows.
 */
import { PluginError } from "../errors.js";

export interface MedusaOrderExchange {
  readonly id: string;
  readonly canceled_at?: string | Date | null;
  /** The exchange's new items (`order_exchange_item`). */
  readonly additional_items?: readonly { readonly item_id?: string | null }[] | null;
}

export interface MedusaOrderClaim {
  readonly id: string;
  readonly canceled_at?: string | Date | null;
  /** `order_claim_item` rows — the replacements are those with `is_additional_item`. */
  readonly additional_items?:
    | readonly {
        readonly item_id?: string | null;
        readonly is_additional_item?: boolean | null;
      }[]
    | null;
}

export type ReplacementKind = "exchange" | "claim";

/** Every order line that is a replacement, with what it replaces in: an exchange or a claim. */
export function replacementLines(
  exchanges: readonly MedusaOrderExchange[],
  claims: readonly MedusaOrderClaim[],
): ReadonlyMap<string, ReplacementKind> {
  const lines = new Map<string, ReplacementKind>();
  for (const exchange of exchanges) {
    if (exchange.canceled_at !== null && exchange.canceled_at !== undefined) continue;
    for (const item of exchange.additional_items ?? []) {
      if (typeof item.item_id === "string") lines.set(item.item_id, "exchange");
    }
  }
  for (const claim of claims) {
    if (claim.canceled_at !== null && claim.canceled_at !== undefined) continue;
    for (const item of claim.additional_items ?? []) {
      if (item.is_additional_item === true && typeof item.item_id === "string") {
        lines.set(item.item_id, "claim");
      }
    }
  }
  return lines;
}

export class ReplacementShipmentError extends PluginError {
  constructor(
    readonly fulfillmentId: string,
    readonly kind: ReplacementKind,
  ) {
    super(
      kind === "exchange" ? "SHIPMENT_OF_EXCHANGE" : "SHIPMENT_OF_CLAIM_REPLACEMENT",
      kind === "exchange"
        ? `Fulfillment ${fulfillmentId} ships the new item of an exchange. An exchange needs the returned ` +
            "item reversed with it, which the plugin does not do: invoice the new item, and credit the returned " +
            "one, outside the plugin."
        : `Fulfillment ${fulfillmentId} ships a replacement from a claim. A warranty replacement needs no ` +
            "invoice, and VAT stated on one would be owed (§14c Abs. 1 UStG): no invoice is issued. If the " +
            "replacement is sold, invoice it outside the plugin.",
    );
    this.name = "ReplacementShipmentError";
  }
}

/** Refuses a fulfillment that ships a replacement — alone or with the order's own lines. */
export function assertNoReplacementShipped(
  fulfillment: {
    readonly id: string;
    readonly items?: readonly { readonly line_item_id?: string | null }[] | null;
  },
  replacements: ReadonlyMap<string, ReplacementKind>,
): void {
  for (const item of fulfillment.items ?? []) {
    const kind =
      typeof item.line_item_id === "string" ? replacements.get(item.line_item_id) : undefined;
    if (kind !== undefined) throw new ReplacementShipmentError(fulfillment.id, kind);
  }
}

export class RefundOnReplacementError extends PluginError {
  constructor(
    readonly orderId: string,
    readonly kind: ReplacementKind,
  ) {
    super(
      kind === "exchange" ? "REFUND_ON_EXCHANGE" : "REFUND_ON_CLAIM_REPLACEMENT",
      kind === "exchange"
        ? `Order ${orderId} has an exchange. A refund on it settles the exchange rather than reducing a price, ` +
            "so no credit note is issued; if part of it does reduce a price, credit that outside the plugin."
        : `Order ${orderId} has a claim with a replacement. A refund on it — the postage of a warranty case, ` +
            "for one — does not reduce a price, so no credit note is issued; if part of it does, credit that " +
            "outside the plugin.",
    );
    this.name = "RefundOnReplacementError";
  }
}

/** Refuses a credit note for a refund on an order with an exchange, or with a claim with a replacement. */
export function assertRefundNotOnReplacement(
  orderId: string,
  exchanges: readonly MedusaOrderExchange[],
  claims: readonly MedusaOrderClaim[],
): void {
  const standing = (row: { readonly canceled_at?: string | Date | null }): boolean =>
    row.canceled_at === null || row.canceled_at === undefined;
  if (exchanges.some(standing)) throw new RefundOnReplacementError(orderId, "exchange");
  if (replacementLines([], claims.filter(standing)).size > 0) {
    throw new RefundOnReplacementError(orderId, "claim");
  }
}
