/**
 * T-071: `payment.refunded` → credit note. Event name/payload verified for real against
 * `@medusajs/utils@2.19.0`'s own compiled `PaymentEvents.REFUNDED` (T-070, `docs/domain-glossary.md`) —
 * the payload carries **only** `{ id }`, the *payment's* id, not the order's. Resolving the order needs
 * several real `query.graph` calls, not one — this is exactly the design question `docs/domain-glossary.md`'s
 * own T-070 entry flagged as unresolved for T-071, and it turned out more involved than a single filter:
 *
 * An earlier version of this file used `filters: { "payment_collections.payments.id": data.id }` directly
 * on the `order` entity — a dot-notation path that IS real and confirmed (`@medusajs/core-flows`'
 * `refundCapturedPaymentsWorkflow` reads exactly this path in its own `fields` array), but only as a
 * *field*. Used as a *filter*, a real e2e run (Docker Postgres, this task's own proof) produced a genuine
 * Postgres error — `missing FROM-clause entry for table "payments"` — because `payment_collections.payments`
 * is a **two-hop cross-module path** (order↔payment_collection is a real module link, `defineLink`;
 * payment_collection→payment is a plain FK *within* the payment module), and `query.graph`'s filter
 * resolution only builds the join for a path that also appears in `fields` *within the same module* — it
 * does not reach across a module link that way. The fix, proven against the same real instance: resolve in
 * steps — (1) query the `payment` entity for its own `payment_collection_id` (a same-module field, no
 * link involved), then (2) read the order's id from the payment collection's side of the link
 * (`payment_collection.order.id`) and (3) query the order by that id. Step 2 used to be a filter on the
 * order's side, `{ payment_collections: { id } }`; that works on Medusa 2.19 and later but not on 2.12,
 * which refuses a filter across a module link ("Trying to query by not existing property
 * Order.payment_collections") — reading a linked field works on every release the e2e matrix tried
 * (P-59 item 8).
 *
 * T-072: one credit note per *refund*, not per payment. The original version of this file treated the
 * whole payment as the idempotency unit (`idempotency_key: data.id`) — wrong for a payment with more than
 * one partial refund, which would only ever get a single credit note total. Fixed by reading
 * `payment.refunds` and iterating: each refund not yet credited gets its own document, keyed by the
 * refund's own id — the same per-refund granularity `@webbers/invoices-medusa`'s own
 * `payment-refunded-invoice` subscriber uses (`resource_id: refund.id`, read directly from their published
 * source, not invented independently).
 *
 * P-41: what a refund credits follows its amount (`refund.amount`), never more than is still outstanding
 * on the invoice (`decideCreditScope`, `mapping/credit-note.ts`). A refund covering the whole invoice, with
 * nothing credited before, restates the whole order (`document.correctedInvoice` pointing at the invoice
 * this plugin generated); any other refund is a one-line credit note over its gross amount, at the
 * invoice's category and rate. An earlier version restated the whole order for every refund, so two
 * refunds of 10 on an order of 100 produced two credit notes of 100 — and its justification that
 * `@webbers/invoices-medusa` issues full documents was wrong: their credit invoices use `refund.amount`.
 * The shared building/storing steps live in `credit-notes/issue-credit-note.ts`.
 *
 * `einvoiceService.options.integration?.kind === "webbers"` reuses their own credit invoice's `display_id`
 * per refund instead of allocating one here — see `invoice-on-fulfillment-created.ts`'s identical comment
 * and `integrations/webbers.ts` for why this needs a poll/wait rather than a plain read.
 *
 * T-073: standalone mode's own equivalent — `einvoiceService.options.standalone?.basePdf`, called per
 * refund with the built credit-note `Invoice` — see `invoice-on-fulfillment-created.ts`'s identical
 * comment for the full reasoning (same option, same embedding step, just invoked once per refund here
 * instead of once per fulfillment).
 *
 * T-074/P-41: the original invoice's XML (BT-2 for the corrected invoice's date, BT-112 for what is
 * outstanding) and every credit note already issued are read back from the File Module (`loadCreditBasis`)
 * once per refund — per refund, because the previous refund in the same event may have credited part of
 * the invoice already. Each credit note's own XML/PDF are uploaded the same way an invoice's are, with the
 * same cleanup-on-lost-race behavior.
 */
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import type { MedusaContainer, SubscriberArgs, SubscriberConfig } from "@medusajs/framework";
import { EINVOICE_MODULE } from "../modules/einvoice/index.js";
import type EinvoiceModuleService from "../modules/einvoice/service.js";
import {
  ORDER_QUERY_FIELDS,
  toAmount,
  type MedusaOrderForInvoice,
} from "../mapping/order-to-commerce-invoice-input.js";
import { creditableRefund, decideCreditScope } from "../mapping/credit-note.js";
import { recordRefusalOfError } from "../refusals.js";
import {
  creditTolerance,
  issueCreditNote,
  loadCreditBasis,
} from "../credit-notes/issue-credit-note.js";

export { extractIssueDateFromCii } from "../mapping/credit-note.js";

interface PaymentRefundedEventData {
  readonly id: string;
}

interface OrderRefund {
  readonly id: string;
  readonly amount?: number | string | null;
  readonly created_at?: Date | string | null;
}

/**
 * P-63: every refund on the order, across its payments, oldest first — what `creditableRefund` counts as
 * already returned. Only read for an invoice with an overpayment notice.
 */
async function listOrderRefunds(
  container: MedusaContainer,
  orderId: string,
): Promise<readonly OrderRefund[]> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const { data } = await query.graph({
    entity: "order",
    filters: { id: orderId },
    fields: [
      "id",
      "payment_collections.payments.refunds.id",
      "payment_collections.payments.refunds.amount",
      "payment_collections.payments.refunds.created_at",
    ],
  });
  const order = data[0] as
    | {
        readonly payment_collections?: readonly {
          readonly payments?:
            readonly { readonly refunds?: readonly OrderRefund[] | null }[] | null;
        }[];
      }
    | undefined;
  const refunds = (order?.payment_collections ?? []).flatMap((collection) =>
    (collection.payments ?? []).flatMap((payment) => payment.refunds ?? []),
  );
  const time = (refund: OrderRefund): number => new Date(refund.created_at ?? 0).getTime();
  return [...refunds].sort((a, b) => time(a) - time(b) || a.id.localeCompare(b.id));
}

function sumBefore(refunds: readonly OrderRefund[], refundId: string): string {
  const index = refunds.findIndex((refund) => refund.id === refundId);
  const before = index === -1 ? refunds : refunds.slice(0, index);
  return toAmount(before.reduce((sum, refund) => sum + Number(refund.amount ?? 0), 0));
}

export class MissingOriginalInvoiceError extends Error {
  constructor(readonly orderId: string) {
    super(
      `Order ${orderId} has a refunded payment but no invoice this plugin generated for it — a credit ` +
        `note needs BT-25/26 (document.correctedInvoice), and this plugin refuses to fabricate a reference ` +
        `to an invoice it never produced (e.g. one issued before this plugin was installed). If the order's ` +
        `invoice was not issued yet, issue it first, then retry this credit note.`,
    );
    this.name = "MissingOriginalInvoiceError";
  }
}

export default async function creditNoteOnPaymentRefunded({
  event: { data },
  container,
}: SubscriberArgs<PaymentRefundedEventData>): Promise<void> {
  const einvoiceService = container.resolve<EinvoiceModuleService>(EINVOICE_MODULE);
  const query = container.resolve(ContainerRegistrationKeys.QUERY);

  const { data: payments } = await query.graph({
    entity: "payment",
    filters: { id: data.id },
    fields: ["id", "payment_collection_id", "refunds.id", "refunds.amount"],
  });
  const payment = payments[0] as
    | {
        readonly payment_collection_id?: string | null;
        readonly refunds?: readonly {
          readonly id: string;
          /** Gross money returned — a `BigNumber` at runtime, read through `Number()`. */
          readonly amount?: number | string | null;
        }[];
      }
    | undefined;
  if (payment?.payment_collection_id === undefined || payment.payment_collection_id === null) {
    // The payment itself is already gone, or was never attached to a payment collection at all (shouldn't
    // happen for a real PaymentEvents.REFUNDED, but this subscriber doesn't assume it) — nothing to credit.
    return;
  }

  const refunds = payment.refunds ?? [];
  if (refunds.length === 0) {
    // A payment.refunded event with no refunds recorded yet (a real, if narrow, timing case) — nothing to
    // credit this delivery; a later delivery (or a manual replay) will find the refund once it's committed.
    return;
  }

  const { data: collections } = await query.graph({
    entity: "payment_collection",
    filters: { id: payment.payment_collection_id },
    fields: ["id", "order.id"],
  });
  const orderId = (
    collections[0] as { readonly order?: { readonly id?: string } | null } | undefined
  )?.order?.id;
  if (orderId === undefined) {
    // No order links to this payment collection (e.g. a cart-level/abandoned payment that never became an
    // order) — nothing this plugin can credit.
    return;
  }
  const { data: orders } = await query.graph({
    entity: "order",
    filters: { id: orderId },
    fields: ORDER_QUERY_FIELDS as unknown as string[],
  });
  const order = orders[0] as MedusaOrderForInvoice | undefined;
  if (order === undefined) {
    return;
  }

  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  for (const refund of refunds) {
    const existing = await einvoiceService.listEinvoiceDocuments({
      type: "credit_note",
      idempotency_key: refund.id,
    });
    if (existing.length > 0) {
      continue;
    }
    // Re-read per refund: the previous iteration may have credited part of the invoice already.
    const basis = await loadCreditBasis(container, einvoiceService, order.id);
    const trigger = { event: "payment.refunded", paymentId: data.id } as const;
    if (basis === undefined) {
      // P-66: recorded, not thrown — once the invoice is issued (a blocked one retried), the credit note's
      // own retry redelivers this event.
      await recordRefusalOfError(
        container,
        einvoiceService,
        { type: "credit_note", orderId: order.id, idempotencyKey: refund.id, trigger },
        new MissingOriginalInvoiceError(order.id),
      );
      continue;
    }
    // P-63: after an invoice with an overpayment notice, a refund returns the overpayment first.
    let requested = toAmount(refund.amount);
    if (Number(basis.overpaid) > 0) {
      requested = creditableRefund({
        refund: requested,
        refundedBefore: sumBefore(await listOrderRefunds(container, order.id), refund.id),
        creditedTotals: basis.creditedTotals,
        overpaid: basis.overpaid,
      });
      if (Number(requested) <= 0) {
        logger.info(
          `einvoice: order ${order.id}: refund ${refund.id} returns the buyer's overpayment noted on ` +
            `invoice ${basis.invoice.document_number} — no credit note.`,
        );
        continue;
      }
    }
    const scope = decideCreditScope({
      requested,
      invoiceTotal: basis.invoiceTotal,
      creditedTotals: basis.creditedTotals,
      tolerance: creditTolerance(order),
    });
    if (scope.kind === "none") {
      logger.warn(
        `einvoice: order ${order.id}: refund ${refund.id} is not credited — the invoice is already ` +
          `fully credited.`,
      );
      continue;
    }
    await issueCreditNote({
      container,
      einvoiceService,
      order,
      basis,
      scope,
      idempotencyKey: refund.id,
      reason: "refund",
      webbersResourceId: refund.id,
      embedWebbersPdf: requested === toAmount(refund.amount),
      trigger,
    });
  }
}

export const config: SubscriberConfig = {
  event: "payment.refunded",
};
