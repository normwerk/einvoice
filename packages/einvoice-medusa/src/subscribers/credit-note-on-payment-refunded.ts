/**
 * T-071: `payment.refunded` → credit note. Event name/payload verified for real against
 * `@medusajs/utils@2.19.0`'s own compiled `PaymentEvents.REFUNDED` (T-070, `docs/domain-glossary.md`) —
 * the payload carries **only** `{ id }`, the *payment's* id, not the order's. Resolving the order needs
 * two real `query.graph` calls, not one — this is exactly the design question `docs/domain-glossary.md`'s
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
 * two steps — (1) query the `payment` entity for its own `payment_collection_id` (a same-module field, no
 * link involved), then (2) query `order` filtered by the *nested-object* form `{ payment_collections: { id:
 * paymentCollectionId } }` (one hop, the real module link `order.order <> payment.payment_collection`,
 * `docs/domain-glossary.md`'s own T-070 entry) — this nested-object shape is what actually resolves a
 * cross-module link filter; the flat dotted-string form does not, at least not two hops deep.
 *
 * The credit note re-states the *whole* original order as a correction (`document.kind: "credit-note"`,
 * `document.correctedInvoice` pointing at the invoice this plugin itself generated for the same order),
 * matching this repo's own `de-credit-note` fixture's shape (a full reversal, not a partial-refund-amount
 * line item) — T-071's scope is wiring the event to a real correction document, not modeling partial
 * refunds against specific order lines (a real, separate design question, not silently assumed answered).
 */
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework";
import { EINVOICE_MODULE } from "../modules/einvoice/index.js";
import type EinvoiceModuleService from "../modules/einvoice/service.js";
import { ModuleNumberingStore } from "../modules/einvoice/numbering-store.js";
import {
  mapOrderToCommerceInvoiceInput,
  ORDER_QUERY_FIELDS,
  resolveB2gBuyerReference,
  type MedusaOrderForInvoice,
} from "../mapping/order-to-commerce-invoice-input.js";

interface PaymentRefundedEventData {
  readonly id: string;
}

export class MissingOriginalInvoiceError extends Error {
  constructor(readonly orderId: string) {
    super(
      `Order ${orderId} has a refunded payment but no invoice this plugin generated for it — a credit ` +
        `note needs BT-25/26 (document.correctedInvoice), and this plugin refuses to fabricate a reference ` +
        `to an invoice it never produced (e.g. one issued before this plugin was installed).`,
    );
    this.name = "MissingOriginalInvoiceError";
  }
}

export default async function creditNoteOnPaymentRefunded({
  event: { data },
  container,
}: SubscriberArgs<PaymentRefundedEventData>): Promise<void> {
  const einvoiceService = container.resolve<EinvoiceModuleService>(EINVOICE_MODULE);

  const existing = await einvoiceService.listEinvoiceDocuments({
    type: "credit_note",
    idempotency_key: data.id,
  });
  if (existing.length > 0) {
    return;
  }

  const query = container.resolve(ContainerRegistrationKeys.QUERY);

  const { data: payments } = await query.graph({
    entity: "payment",
    filters: { id: data.id },
    fields: ["id", "payment_collection_id"],
  });
  const payment = payments[0] as { readonly payment_collection_id?: string | null } | undefined;
  if (payment?.payment_collection_id === undefined || payment.payment_collection_id === null) {
    // The payment itself is already gone, or was never attached to a payment collection at all (shouldn't
    // happen for a real PaymentEvents.REFUNDED, but this subscriber doesn't assume it) — nothing to credit.
    return;
  }

  const { data: orders } = await query.graph({
    entity: "order",
    filters: { payment_collections: { id: payment.payment_collection_id } },
    fields: ORDER_QUERY_FIELDS as unknown as string[],
  });
  const order = orders[0] as MedusaOrderForInvoice | undefined;
  if (order === undefined) {
    // No order links to this payment collection (e.g. a cart-level/abandoned payment that never became an
    // order) — nothing this plugin can credit.
    return;
  }

  const originalInvoices = await einvoiceService.listEinvoiceDocuments({
    type: "invoice",
    order_id: order.id,
  });
  const originalInvoice = originalInvoices[0];
  if (originalInvoice === undefined) {
    throw new MissingOriginalInvoiceError(order.id);
  }

  const commerce = await import("@normwerk/einvoice-commerce");
  const cii = await import("@normwerk/einvoice-cii");

  const issueDate = new Date().toISOString().slice(0, 10);

  const input = mapOrderToCommerceInvoiceInput(order, {
    seller: einvoiceService.options.seller,
    kind: "credit-note",
    issueDate,
    deRates: { standard: commerce.DE_STANDARD_RATE, reduced: commerce.DE_REDUCED_RATE },
    payment: einvoiceService.options.payment,
    correctedInvoice: {
      number: originalInvoice.document_number,
      // The original invoice's own issue date isn't stored on EinvoiceDocument today (only its number and
      // XML) — re-derived here from today's date would be wrong, so this plugin parses it back out of the
      // XML it already generated rather than adding a field speculatively; T-074's storage redesign is the
      // natural place to store this explicitly instead, if this parse ever proves fragile in practice.
      issueDate: extractIssueDateFromCii(originalInvoice.xml),
    },
  });

  // The *raw* B2G signal, not `input.references.buyerReference` — see the invoice subscriber's identical
  // comment (`invoice-on-fulfillment-created.ts`) for why these are deliberately different values.
  const profile = commerce.selectProfile({
    buyerCountry: input.buyer.countryCode,
    buyerReference: resolveB2gBuyerReference(order),
    preferredProfile: einvoiceService.options.defaultProfile,
  });

  const numberer = new commerce.SequentialNumberer(new ModuleNumberingStore(einvoiceService));
  const documentNumber = await numberer.next({ kind: "credit-note", issueDate });

  const buildResult = commerce.buildInvoice({
    ...input,
    document: { ...input.document, number: documentNumber },
  });

  const ciiProfile = profile === "XRECHNUNG" ? "xrechnung-3.0-cii" : "en16931-cii";
  const { xml } = cii.serializeCii(buildResult.invoice, { profile: ciiProfile });

  await einvoiceService.recordDocumentIfAbsent({
    type: "credit_note",
    orderId: order.id,
    idempotencyKey: data.id,
    documentNumber,
    xml,
  });
}

/**
 * `ram:IssueDateTime`/`udt:DateTimeString` (CII D16B, format "102" = `YYYYMMDD`) is the one element
 * `serializeWithPlan` always emits for BT-2 — extracted with a plain regex rather than a full XML parse
 * (no XML parser is a dependency of this plugin, and this repo's own serializer never produces attributes
 * or whitespace that could make a targeted regex ambiguous here, unlike parsing arbitrary third-party XML).
 */
export function extractIssueDateFromCii(xml: string): string {
  const match = /<ram:IssueDateTime>\s*<udt:DateTimeString[^>]*>(\d{8})<\/udt:DateTimeString>/.exec(
    xml,
  );
  if (match === null) {
    throw new Error("extractIssueDateFromCii: no ram:IssueDateTime/udt:DateTimeString found.");
  }
  const digits = match[1] as string;
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
}

export const config: SubscriberConfig = {
  event: "payment.refunded",
};
