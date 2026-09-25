/**
 * P-63: issuing the invoice for one fulfillment — the `order.fulfillment_created` subscriber
 * (`subscribers/invoice-on-fulfillment-created.ts`) and the admin retry route both call
 * `issueInvoiceForFulfillment`. Lives outside `src/subscribers/` on purpose: Medusa loads every file there
 * as a subscriber. Before the document number is taken, the invoice is checked against what Medusa charged
 * (`reconcileWithCharged`, `mapping/charged-reconciliation.ts`): a block records a refusal instead of a
 * document and takes no number; a notice is stored on the document. Both go to the log at warn level with
 * codes and amounts only. P-66: so does every other refusal before the number — `buildInvoice`'s, the
 * mapping's, a failed VAT-ID check (`refusals.ts`): recorded, shown in the admin and retried from there,
 * instead of thrown into a log nobody reads.
 *
 * P-67 (M-045): the invoice covers the fulfillment's own lines and units (`mapping/shipment.ts`), dated the
 * day it shipped (BT-72); the order's shipping goes on the first invoice still standing, and a line's
 * discount is shared out so the invoices of a line add up to it. P-69: the check against what Medusa
 * charged compares with that fulfillment's share (`chargedForShipment`). An order paid in full before it
 * shipped gets invoices that state it (BT-113 = total, nothing due).
 *
 * T-071: `order.fulfillment_created` → e-invoice XML. Event name/payload shape verified for real against
 * `@medusajs/utils@2.19.0`'s own compiled `OrderWorkflowEvents.FULFILLMENT_CREATED` (T-070,
 * `docs/domain-glossary.md`) — `{ order_id, fulfillment_id, no_notification }`, matching plan-v0.1's own
 * expectation.
 *
 * `@normwerk/einvoice-commerce`/`@normwerk/einvoice-cii`/`@normwerk/einvoice-pdfa` are loaded with a
 * dynamic `import()`, not a static one — all three are ESM-only packages and this plugin compiles to
 * CommonJS (T-070's verified finding); a static value import here would compile to a `require()` that
 * throws `ERR_REQUIRE_ESM` at runtime. This is the real, necessary fix for a CJS module needing an
 * ESM-only package's actual functions at runtime, not the type-only `resolution-mode` import attribute
 * T-070 used (that only ever affects how TypeScript resolves *types*, never how Node resolves a value at
 * runtime).
 *
 * Idempotency: checked *before* any work — `einvoiceService.listEinvoiceDocuments` for this
 * `(type, idempotency_key)` short-circuits a redelivered event without allocating a fresh document number,
 * so a redelivery never burns one (a gap is lawful, a wasted number still confusing) in the realistic
 * redelivery case (Medusa's local event bus never retries by default — `docs/domain-glossary.md` — so a genuine
 * redelivery here means a manual replay/retry, which is sequential, not concurrent, with the original
 * delivery). `recordDocumentIfAbsent`'s own database-level `UNIQUE` guard (`service.ts`) is the backstop
 * for the narrower case this check alone can't cover: two literally concurrent deliveries of the same
 * event both passing this check before either has inserted — a real edge case worth naming rather than
 * silently assuming away, not one this plugin's local event bus can actually produce today.
 *
 * T-073: `einvoiceService.options.standalone?.basePdf` is called with the built `Invoice` once it has its
 * number, and its return value (or `undefined`, for pure XML) is embedded as PDF/A-3 (`embedInvoiceInPdfA3`,
 * `@normwerk/einvoice-pdfa`). P-68 (M-040): the mode that reused `@webbers/invoices-medusa`'s number and PDF
 * is gone — their PDF shows Medusa's totals, not the e-invoice's.
 *
 * T-074: the XML/PDF this subscriber produces are uploaded to the File Module (`storage.ts`,
 * `access: "private"`) instead of being stored inline — `recordDocumentIfAbsent` now takes file ids, not
 * content. Files are uploaded *before* the idempotency-guarding insert (there is no other order — the
 * insert needs the ids), so the true-concurrency edge case this file's own doc comment already names above
 * (two deliveries both passing the pre-check) now also orphans a just-uploaded file for whichever delivery
 * loses the insert, not just a wasted document number — `result.created === false` is the signal to clean
 * those up (`deleteEinvoiceFiles`), a real, small extension of an already-documented edge case rather than
 * a new one.
 */
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import type { MedusaContainer } from "@medusajs/framework";
import { EINVOICE_MODULE } from "../modules/einvoice/index.js";
import type EinvoiceModuleService from "../modules/einvoice/service.js";
import type { EinvoiceDocumentRecord, EinvoiceRefusalRecord } from "../modules/einvoice/service.js";
import { ModuleNumberingStore } from "../modules/einvoice/numbering-store.js";
import { deleteEinvoiceFiles, storeEinvoiceFiles } from "../storage.js";
import { recordRefusalOfError } from "../refusals.js";
import { invoicedLineValues } from "../mapping/credit-note.js";
import {
  issueDateInSellerTimeZone,
  mapOrderToCommerceInvoiceInput,
  ORDER_QUERY_FIELDS,
  orderPaidInFull,
  type MedusaOrderForInvoice,
  type ShipmentScope,
  UNALLOCATED_DOCUMENT_NUMBER,
} from "../mapping/order-to-commerce-invoice-input.js";
import {
  chargedForShipment,
  describeChargedReconciliation,
  reconcileWithCharged,
  type InvoiceNotice,
} from "../mapping/charged-reconciliation.js";
import { shipmentLines, type LineInvoicedBefore } from "../mapping/shipment.js";
import { taxEvidenceToKeep } from "../mapping/tax-evidence.js";
import { PluginError } from "../errors.js";
import { emitDocumentIssued, emitIssuanceBlocked } from "../events.js";

/**
 * P-67: the order's invoices still standing — those whose fulfillment was not cancelled (a cancelled
 * fulfillment's invoice is credited in full, and its units ship again in another one).
 */
export function standingInvoices(
  order: MedusaOrderForInvoice,
  invoices: readonly EinvoiceDocumentRecord[],
): readonly EinvoiceDocumentRecord[] {
  const canceled = new Set(
    (order.fulfillments ?? [])
      .filter(
        (fulfillment) => fulfillment.canceled_at !== null && fulfillment.canceled_at !== undefined,
      )
      .map((fulfillment) => fulfillment.id),
  );
  return invoices.filter((invoice) => !canceled.has(invoice.idempotency_key));
}

export interface IssueInvoiceRequest {
  readonly orderId: string;
  readonly fulfillmentId: string;
}

export type IssueInvoiceOutcome =
  /** A document for this fulfillment already exists — nothing was done. */
  | { readonly kind: "exists" }
  /** The order is gone — nothing to invoice. */
  | { readonly kind: "order-missing" }
  /** P-67: the fulfillment was cancelled before its invoice was issued — nothing to invoice. */
  | { readonly kind: "fulfillment-canceled" }
  | {
      readonly kind: "issued";
      readonly documentNumber: string;
      readonly notice: InvoiceNotice | null;
    }
  /** Not issued — the invoice disagrees with what Medusa charged, or was refused (P-66). No number was
   * taken; the refusal is recorded. */
  | { readonly kind: "blocked"; readonly refusal: EinvoiceRefusalRecord; readonly message: string };

export async function issueInvoiceForFulfillment(
  container: MedusaContainer,
  { orderId, fulfillmentId }: IssueInvoiceRequest,
): Promise<IssueInvoiceOutcome> {
  const einvoiceService = container.resolve<EinvoiceModuleService>(EINVOICE_MODULE);

  const existing = await einvoiceService.listEinvoiceDocuments({
    type: "invoice",
    idempotency_key: fulfillmentId,
  });
  if (existing.length > 0) {
    return { kind: "exists" };
  }

  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const { data: orders } = await query.graph({
    entity: "order",
    filters: { id: orderId },
    fields: ORDER_QUERY_FIELDS as unknown as string[],
  });
  const order = orders[0] as MedusaOrderForInvoice | undefined;
  if (order === undefined) {
    // The order is gone by the time this runs (async delivery) — nothing to invoice, and there's nothing
    // to retry into existing either.
    return { kind: "order-missing" };
  }

  const fulfillment = order.fulfillments?.find((candidate) => candidate.id === fulfillmentId);
  if (fulfillment?.canceled_at !== null && fulfillment?.canceled_at !== undefined) {
    await einvoiceService.clearRefusal("invoice", fulfillmentId);
    return { kind: "fulfillment-canceled" };
  }

  const commerce = await import("@normwerk/einvoice-commerce");
  const cii = await import("@normwerk/einvoice-cii");

  const now = () => einvoiceService.options.now?.() ?? new Date();
  const issueDate = issueDateInSellerTimeZone(einvoiceService.options.seller.countryCode, now());
  const refused = async (error: unknown): Promise<IssueInvoiceOutcome> => ({
    kind: "blocked",
    ...(await recordRefusalOfError(
      container,
      einvoiceService,
      { type: "invoice", orderId: order.id, idempotencyKey: fulfillmentId },
      error,
    )),
  });

  // P-66: everything up to the check build can refuse the invoice — recorded, not thrown.
  const prepare = async () => {
    if (fulfillment === undefined) {
      throw new PluginError(
        "FULFILLMENT_MISSING",
        `Order ${order.id} has no fulfillment ${fulfillmentId} to invoice.`,
      );
    }
    // P-67: what the order's other invoices already took — units, discount, and the shipping.
    const others = standingInvoices(
      order,
      (await einvoiceService.listEinvoiceDocuments({
        type: "invoice",
        order_id: order.id,
      })) as unknown as EinvoiceDocumentRecord[],
    );
    const invoicedBefore: LineInvoicedBefore[] = others.flatMap((invoice) =>
      (invoice.line_values ?? []).map((line) => ({
        itemId: line.itemId,
        quantity: line.quantity,
        allowance: line.allowance ?? "0.00",
      })),
    );
    const shipment: ShipmentScope = {
      lines: shipmentLines(order.items, fulfillment, invoicedBefore),
      includesShipping: !others.some((invoice) => invoice.includes_shipping),
      deliveryDate: issueDateInSellerTimeZone(
        einvoiceService.options.seller.countryCode,
        fulfillment.created_at ? new Date(fulfillment.created_at) : now(),
      ),
    };
    const input = mapOrderToCommerceInvoiceInput(order, {
      seller: einvoiceService.options.seller,
      kind: "invoice",
      issueDate,
      payment: einvoiceService.options.payment,
      ossRegistered: einvoiceService.options.ossRegistered,
      shipment,
    });

    // P-54: only a declared Leitweg-ID routes to XRechnung — never BT-10's free text, which is always filled.
    const profile = commerce.selectProfile({
      buyerCountry: input.buyer.countryCode,
      leitwegId: input.references?.leitwegId,
      preferredProfile: einvoiceService.options.defaultProfile,
    });

    // T-079/P-12: VAT-ID verification is real I/O — it happens here, before buildInvoice, never inside it
    // (ADR-003). Only attempted when both a verifier is configured and the buyer actually has a VAT-ID to
    // check; omitting either keeps category K unreachable, same as today (service.ts's own doc comment).
    const vatIdEvidence =
      einvoiceService.options.vatIdVerifier !== undefined &&
      input.taxContext.buyerVatId !== undefined
        ? await einvoiceService.options.vatIdVerifier.verify(input.taxContext.buyerVatId, now())
        : undefined;

    const buildOptions = vatIdEvidence === undefined ? {} : { vatIdEvidence };
    // P-48: every refusal `buildInvoice` can raise — a missing fact, an undecidable category, a rate it
    // cannot invoice — happens here, before a document number is taken, so a refused order leaves no hole
    // in the series. The number is the only input the real build below adds.
    const check = commerce.buildInvoice(
      { ...input, document: { ...input.document, number: UNALLOCATED_DOCUMENT_NUMBER } },
      buildOptions,
    );
    return { input, profile, buildOptions, check, shipment };
  };
  let prepared: Awaited<ReturnType<typeof prepare>>;
  try {
    prepared = await prepare();
  } catch (error) {
    return refused(error);
  }
  const { input, profile, buildOptions, check, shipment } = prepared;

  // P-63: the check against what Medusa charged runs on the check build's totals — the number does not
  // change them — so a blocked invoice takes no number either.
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const reconciliation = reconcileWithCharged(
    order,
    check.invoice,
    chargedForShipment(order, shipment),
  );
  if (reconciliation.outcome === "block") {
    const message = describeChargedReconciliation(reconciliation.block);
    logger.warn(
      `einvoice: order ${order.id}: invoice for fulfillment ${fulfillmentId} — ${message} ` +
        `[${reconciliation.block.code}]`,
    );
    const refusal = await einvoiceService.recordRefusal({
      type: "invoice",
      orderId: order.id,
      idempotencyKey: fulfillmentId,
      code: reconciliation.block.code,
      details: { ...reconciliation.block },
    });
    // P-71: the shop's own code hears of it.
    await emitIssuanceBlocked(container, {
      refusal_id: refusal.id,
      order_id: order.id,
      type: "invoice",
      code: refusal.code,
    });
    return { kind: "blocked", refusal, message };
  }
  const notice = reconciliation.outcome === "notice" ? reconciliation.notice : null;

  const numberer = new commerce.SequentialNumberer(new ModuleNumberingStore(einvoiceService));
  const documentNumber = await numberer.next({ kind: "invoice", issueDate });

  // P-67: an order paid in full before it shipped — the invoice states its total as paid.
  const paidAmount = orderPaidInFull(order) ? check.invoice.totals.totalAmountWithVat : undefined;
  const buildResult = commerce.buildInvoice(
    { ...input, paidAmount, document: { ...input.document, number: documentNumber } },
    buildOptions,
  );

  // P-39: `buildInvoice` reports what it could not map or had to assume (`BuildResult.warnings`); it goes
  // to the log at warn level, as does a notice (P-63) — codes, messages and amounts only, never the invoice
  // payload or the buyer's details (AGENTS.md §5.2).
  for (const warning of buildResult.warnings) {
    logger.warn(`einvoice: order ${order.id}: ${warning.message} [${warning.code}]`);
  }
  if (notice !== null) {
    logger.warn(
      `einvoice: order ${order.id}: invoice ${documentNumber} issued with a notice — ` +
        `${describeChargedReconciliation(notice)} [${notice.code}]`,
    );
  }

  // T-073: the merchant's own PDF, if any — see this file's own doc comment.
  const basePdfBytes = await einvoiceService.options.standalone?.basePdf?.(buildResult.invoice);

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
    type: "invoice",
    orderId: order.id,
    idempotencyKey: fulfillmentId,
    documentNumber,
    xmlFileId: stored.xmlFileId,
    pdfFileId: stored.pdfFileId,
    notice,
    // P-65: what each order line was invoiced at — a later return is credited at that; P-67: and its share
    // of the line's discount.
    lineValues: invoicedLineValues(shipment.lines, buildResult.invoice.lines),
    includesShipping: shipment.includesShipping,
    // T-192: the VIES answer a K invoice rests on, and the rule it followed.
    ...taxEvidenceToKeep(buildResult),
  });

  if (!result.created) {
    // Lost a true-concurrency race against another delivery of this same event — see this file's own doc
    // comment. The files just uploaded above are for a document nobody will ever read; clean them up.
    await deleteEinvoiceFiles(
      container,
      stored.pdfFileId === null ? [stored.xmlFileId] : [stored.xmlFileId, stored.pdfFileId],
    );
    return { kind: "exists" };
  }
  await einvoiceService.clearRefusal("invoice", fulfillmentId);
  // P-71: after the document is written — a redelivery that found it already issued returned above.
  await emitDocumentIssued(container, {
    id: result.document.id,
    order_id: order.id,
    type: "invoice",
    document_number: documentNumber,
    fulfillment_id: fulfillmentId,
    ...(notice === null ? {} : { notice_code: notice.code }),
  });
  return { kind: "issued", documentNumber, notice };
}
