/**
 * P-67 (M-045): an invoice per fulfillment, for the lines and quantities it shipped. Two invoices for one
 * supply make the VAT owed twice (UStAE 14c.1 Abs. 4, BFH XI R 54/93), and each shipment is a supply of its
 * own with its own date (§14 Abs. 4 Nr. 6 UStG) — so a second fulfillment no longer invoices the whole order
 * again, it invoices what it shipped. An order shipped at once still gets exactly one invoice.
 *
 * A line's promotion discount (BG-27) goes with its units: each invoice takes the share of its quantity,
 * and the invoice that ships a line's last units takes what is left, so the invoices of a line add up to the
 * line to the cent. The discount for the whole line is Medusa's own: Medusa prorates a line's discount to
 * the units the buyer still has (`@medusajs/utils` `getLineItemTotals`: quantity less received and
 * dismissed returns — the same on 2.12 and 2.19), so it is scaled back to the ordered quantity here.
 *
 * T-202: the units come from the order's own record of the fulfillment, not from the fulfillment's items. For a
 * variant with stock managed, Medusa creates a fulfillment item per inventory item, each with its units times
 * the variant's `required_quantity` (`@medusajs/core-flows` `create-fulfillment.js`, `prepareFulfillmentData`):
 * a table-and-four-chairs set ships as 1 + 4 units of one line. The order records the line's own units in a
 * `FULFILL_ITEM` action with the fulfillment's id (`@medusajs/order` `registerFulfillment`).
 *
 * Pure: the order, the fulfillment, the order's changes and what earlier invoices took come in; the caller
 * stores the result.
 */
import type { Amount } from "@normwerk/einvoice-model" with {
  "resolution-mode": "import",
};
import { PluginError } from "../errors.js";
import type { MedusaOrderLineItem } from "./order-to-commerce-invoice-input.js";

/** A Medusa fulfillment with the order lines it ships (`fulfillment_items`, `@medusajs/fulfillment`). */
export interface MedusaFulfillment {
  readonly id: string;
  readonly created_at?: string | Date | null;
  readonly canceled_at?: string | Date | null;
  readonly items?:
    | readonly {
        readonly line_item_id?: string | null;
        readonly quantity?: number | string | null;
      }[]
    | null;
}

/** T-202: an order change as Query reads it (`order_change`): the actions Medusa recorded on the order. */
export interface MedusaOrderChange {
  readonly actions?:
    | readonly {
        readonly action?: string | null;
        readonly reference_id?: string | null;
        readonly details?: Readonly<Record<string, unknown>> | null;
      }[]
    | null;
}

/** One order line on a shipment's document: the line, its units, and the line discount for those units, in
 * the line's own price basis (VAT included for a tax-inclusive line). */
export interface ShipmentLine {
  readonly itemId: string;
  readonly quantity: string;
  readonly allowance: Amount;
  /** T-199: on a credit note, the rate the invoice it corrects stated for the line — it is credited at it. */
  readonly invoicedRate?: string;
}

/** What earlier invoices of the order took of a line. */
export interface LineInvoicedBefore {
  readonly itemId: string;
  readonly quantity: string;
  readonly allowance: Amount;
}

export class ShipmentLineUnknownError extends PluginError {
  constructor(
    readonly fulfillmentId: string,
    readonly lineItemId: string,
  ) {
    super(
      "SHIPMENT_LINE_UNKNOWN",
      `Fulfillment ${fulfillmentId} ships line item ${lineItemId}, which the order does not have — or every ` +
        "unit of that line came back before this invoice was issued, so what it was sold for cannot be " +
        "read from Medusa any more. Issue this invoice outside the plugin.",
    );
    this.name = "ShipmentLineUnknownError";
  }
}

export class ShipmentQuantityUnknownError extends PluginError {
  constructor(
    readonly fulfillmentId: string,
    readonly lineItemId: string,
  ) {
    super(
      "SHIPMENT_QUANTITY_UNKNOWN",
      `The order does not record how many units of line item ${lineItemId} fulfillment ${fulfillmentId} ` +
        "shipped, so the invoice cannot state its quantity. Issue this invoice outside the plugin.",
    );
    this.name = "ShipmentQuantityUnknownError";
  }
}

/** The units of each order line the fulfillment shipped: its lines, with the units the order recorded. */
function unitsShipped(
  fulfillment: MedusaFulfillment,
  changes: readonly MedusaOrderChange[],
): ReadonlyMap<string, number> {
  const recorded = new Map<string, number>();
  for (const action of changes.flatMap((change) => change.actions ?? [])) {
    if (action.action !== "FULFILL_ITEM" || action.reference_id !== fulfillment.id) continue;
    const lineItemId = action.details?.["reference_id"];
    const quantity = Number(action.details?.["quantity"] ?? 0);
    if (typeof lineItemId === "string" && quantity > 0) {
      recorded.set(lineItemId, (recorded.get(lineItemId) ?? 0) + quantity);
    }
  }
  const shipped = new Map<string, number>();
  for (const entry of fulfillment.items ?? []) {
    const lineItemId = entry.line_item_id;
    if (typeof lineItemId !== "string" || Number(entry.quantity ?? 0) <= 0) continue;
    const quantity = recorded.get(lineItemId);
    if (quantity === undefined) {
      throw new ShipmentQuantityUnknownError(fulfillment.id, lineItemId);
    }
    shipped.set(lineItemId, quantity);
  }
  return shipped;
}

function cents(value: number | string | null | undefined): number {
  return Math.round(Number(value ?? 0) * 100);
}

function amount(valueInCents: number): Amount {
  return (valueInCents / 100).toFixed(2);
}

/** The line's discount for its ordered quantity, in cents, in the line's price basis — `undefined` when
 * Medusa's totals no longer say (every unit returned). */
function fullLineAllowanceCents(item: MedusaOrderLineItem): number | undefined {
  const ordered = Number(item.detail?.quantity ?? 0);
  const returned =
    Number(item.detail?.return_received_quantity ?? 0) +
    Number(item.detail?.return_dismissed_quantity ?? 0);
  const current = ordered - returned;
  const discount = item.is_tax_inclusive ? item.discount_total : item.discount_subtotal;
  if (cents(discount) === 0) return 0;
  if (current <= 0) return undefined;
  return Math.round((cents(discount) * ordered) / current);
}

/** P-67: whether part of the order is not shipped yet — Medusa's own count of fulfilled units per line. */
export function hasUnshippedPart(items: readonly MedusaOrderLineItem[]): boolean {
  return items.some(
    (item) => Number(item.detail?.fulfilled_quantity ?? 0) < Number(item.detail?.quantity ?? 0),
  );
}

/**
 * The lines a fulfillment invoices: each shipped line with its quantity and its share of the line discount;
 * the shipment that completes a line takes what earlier invoices left of it.
 */
export function shipmentLines(
  items: readonly MedusaOrderLineItem[],
  fulfillment: MedusaFulfillment,
  changes: readonly MedusaOrderChange[],
  invoicedBefore: readonly LineInvoicedBefore[],
): readonly ShipmentLine[] {
  return [...unitsShipped(fulfillment, changes).entries()].map(([itemId, quantity]) => {
    const item = items.find((candidate) => candidate.id === itemId);
    const full = item === undefined ? undefined : fullLineAllowanceCents(item);
    if (item === undefined || full === undefined) {
      throw new ShipmentLineUnknownError(fulfillment.id, itemId);
    }
    const ordered = Number(item.detail?.quantity ?? quantity);
    const before = invoicedBefore.filter((line) => line.itemId === itemId);
    const quantityBefore = before.reduce((sum, line) => sum + Number(line.quantity), 0);
    const allowanceBefore = before.reduce((sum, line) => sum + cents(line.allowance), 0);
    const allowance =
      quantityBefore + quantity >= ordered
        ? Math.max(0, full - allowanceBefore)
        : Math.round((full * quantity) / ordered);
    return { itemId, quantity: String(quantity), allowance: amount(allowance) };
  });
}
