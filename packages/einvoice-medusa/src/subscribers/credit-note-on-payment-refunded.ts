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
 * T-072: one credit note per *refund*, not per payment. The original version of this file treated the
 * whole payment as the idempotency unit (`idempotency_key: data.id`) — wrong for a payment with more than
 * one partial refund, which would only ever get a single credit note total. Fixed by reading
 * `payment.refunds` and iterating: each refund not yet credited gets its own document, keyed by the
 * refund's own id — the same per-refund granularity `@webbers/invoices-medusa`'s own
 * `payment-refunded-invoice` subscriber uses (`resource_id: refund.id`, read directly from their published
 * source, not invented independently).
 *
 * The credit note re-states the *whole* original order as a correction (`document.kind: "credit-note"`,
 * `document.correctedInvoice` pointing at the invoice this plugin itself generated for the same order),
 * matching this repo's own `de-credit-note` fixture's shape (a full reversal, not a partial-refund-amount
 * line item) — modeling a credit note against specific order lines/amounts is a real, separate design
 * question this task doesn't attempt (`@webbers/invoices-medusa` doesn't decompose order lines for this
 * either — its own credit invoices are full documents referencing a parent, the same shape used here).
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
 * T-074: the original invoice's XML (needed for `extractIssueDateFromCii`, BT-2 on the corrected invoice)
 * is no longer inline on `EinvoiceDocument` — it's fetched once from the File Module (`storage.ts`) before
 * the per-refund loop, not once per refund, since it's the same file every time. Each credit note's own
 * new XML/PDF are then uploaded the same way `invoice-on-fulfillment-created.ts` uploads an invoice's —
 * same helper, same cleanup-on-lost-race behavior, per refund instead of once.
 */
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import type { MedusaContainer, SubscriberArgs, SubscriberConfig } from "@medusajs/framework";
import { EINVOICE_MODULE } from "../modules/einvoice/index.js";
import type EinvoiceModuleService from "../modules/einvoice/service.js";
import { ModuleNumberingStore } from "../modules/einvoice/numbering-store.js";
import {
  fetchWebbersPdfBytes,
  waitForWebbersInvoice,
  WebbersInvoiceNotFoundError,
} from "../integrations/webbers.js";
import { deleteEinvoiceFiles, fetchFileBytes, storeEinvoiceFiles } from "../storage.js";
import {
  issueDateInSellerTimeZone,
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
  const query = container.resolve(ContainerRegistrationKeys.QUERY);

  const { data: payments } = await query.graph({
    entity: "payment",
    filters: { id: data.id },
    fields: ["id", "payment_collection_id", "refunds.id"],
  });
  const payment = payments[0] as
    | {
        readonly payment_collection_id?: string | null;
        readonly refunds?: readonly { readonly id: string }[];
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
  const originalXmlBytes = await fetchFileBytes(container, originalInvoice.xml_file_id);
  const originalIssueDate = extractIssueDateFromCii(
    Buffer.from(originalXmlBytes).toString("utf-8"),
  );

  for (const refund of refunds) {
    await creditOneRefund({
      einvoiceService,
      container,
      order,
      originalInvoice,
      originalIssueDate,
      refundId: refund.id,
    });
  }
}

interface CreditOneRefundInput {
  readonly einvoiceService: EinvoiceModuleService;
  readonly container: MedusaContainer;
  readonly order: MedusaOrderForInvoice;
  readonly originalInvoice: { readonly document_number: string };
  readonly originalIssueDate: string;
  readonly refundId: string;
}

async function creditOneRefund({
  einvoiceService,
  container,
  order,
  originalInvoice,
  originalIssueDate,
  refundId,
}: CreditOneRefundInput): Promise<void> {
  const existing = await einvoiceService.listEinvoiceDocuments({
    type: "credit_note",
    idempotency_key: refundId,
  });
  if (existing.length > 0) {
    return;
  }

  const commerce = await import("@normwerk/einvoice-commerce");
  const cii = await import("@normwerk/einvoice-cii");

  const now = () => einvoiceService.options.now?.() ?? new Date();
  const issueDate = issueDateInSellerTimeZone(einvoiceService.options.seller.countryCode, now());

  const input = mapOrderToCommerceInvoiceInput(order, {
    seller: einvoiceService.options.seller,
    kind: "credit-note",
    issueDate,
    deRates: { standard: commerce.DE_STANDARD_RATE, reduced: commerce.DE_REDUCED_RATE },
    payment: einvoiceService.options.payment,
    ossRegistered: einvoiceService.options.ossRegistered,
    correctedInvoice: {
      number: originalInvoice.document_number,
      // The original invoice's own issue date isn't stored on EinvoiceDocument as its own field (only its
      // number and a file id) — re-derived here from today's date would be wrong, so this plugin parses it
      // back out of the XML it already generated (fetched once, outside this per-refund function) rather
      // than adding a field speculatively.
      issueDate: originalIssueDate,
    },
  });

  // The *raw* B2G signal, not `input.references.buyerReference` — see the invoice subscriber's identical
  // comment (`invoice-on-fulfillment-created.ts`) for why these are deliberately different values.
  const profile = commerce.selectProfile({
    buyerCountry: input.buyer.countryCode,
    buyerReference: resolveB2gBuyerReference(order),
    preferredProfile: einvoiceService.options.defaultProfile,
  });

  const integration = einvoiceService.options.integration;
  let documentNumber: string;
  let basePdfBytes: Uint8Array | undefined;

  if (integration?.kind === "webbers") {
    const webbersInvoice = await waitForWebbersInvoice(container, order.id, {
      resourceId: refundId,
      type: "credit",
      timeoutMs: integration.waitForInvoiceMs,
      pollIntervalMs: integration.pollIntervalMs,
    });
    if (webbersInvoice === undefined) {
      throw new WebbersInvoiceNotFoundError(order.id, refundId, "credit");
    }
    documentNumber = String(webbersInvoice.invoice.display_id);
    if (webbersInvoice.invoice.pdf_url !== null) {
      basePdfBytes = await fetchWebbersPdfBytes(container, webbersInvoice.invoice.pdf_url);
    }
  } else {
    const numberer = new commerce.SequentialNumberer(new ModuleNumberingStore(einvoiceService));
    documentNumber = await numberer.next({ kind: "credit-note", issueDate });
  }

  // T-079/P-12: same VIES-evidence wiring as invoice-on-fulfillment-created.ts's identical comment.
  const vatIdEvidence =
    einvoiceService.options.vatIdVerifier !== undefined && input.taxContext.buyerVatId !== undefined
      ? await einvoiceService.options.vatIdVerifier.verify(input.taxContext.buyerVatId, now())
      : undefined;

  const buildResult = commerce.buildInvoice(
    { ...input, document: { ...input.document, number: documentNumber } },
    vatIdEvidence === undefined ? {} : { vatIdEvidence },
  );

  // T-073: standalone mode's own PDF source — see invoice-on-fulfillment-created.ts's identical comment.
  if (integration?.kind !== "webbers") {
    basePdfBytes = await einvoiceService.options.standalone?.basePdf?.(buildResult.invoice);
  }

  const ciiProfile = profile === "XRECHNUNG" ? "xrechnung-3.0-cii" : "en16931-cii";
  const { xml } = cii.serializeCii(buildResult.invoice, { profile: ciiProfile });

  let finalPdfBytes: Uint8Array | undefined;
  if (basePdfBytes !== undefined) {
    const pdfa = await import("@normwerk/einvoice-pdfa");
    const { pdfBytes } = await pdfa.embedInvoiceInPdfA3(basePdfBytes, xml, {
      profile,
      title: documentNumber,
    });
    finalPdfBytes = pdfBytes;
  }

  const stored = await storeEinvoiceFiles(container, {
    filenamePrefix: documentNumber,
    xml,
    pdfBytes: finalPdfBytes,
  });

  const result = await einvoiceService.recordDocumentIfAbsent({
    type: "credit_note",
    orderId: order.id,
    idempotencyKey: refundId,
    documentNumber,
    xmlFileId: stored.xmlFileId,
    pdfFileId: stored.pdfFileId,
  });

  if (!result.created) {
    // Same lost-race cleanup as invoice-on-fulfillment-created.ts's identical branch.
    await deleteEinvoiceFiles(
      container,
      stored.pdfFileId === null ? [stored.xmlFileId] : [stored.xmlFileId, stored.pdfFileId],
    );
  }
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
