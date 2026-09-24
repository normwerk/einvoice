/**
 * P-41: issuing a credit note (381) against an invoice this plugin generated — shared by the refund
 * subscriber (`payment.refunded`) and the cancellation subscriber (`order.canceled`). Lives outside
 * `src/subscribers/` on purpose: Medusa loads every file there as a subscriber.
 *
 * What a credit note contains is decided by `decideCreditScope` (`mapping/credit-note.ts`): the whole
 * order restated, or one VAT-inclusive line over a credited gross sum. Its VAT category and rate always
 * come from `@normwerk/einvoice-commerce` (`decideVatCategory`, and `buildInvoice` for the rate the VAT
 * is taken out at) — this file asks, it does not decide. The VAT-ID check and the partial-credit refusal run before a document number is
 * allocated, so neither burns a number.
 *
 * Same dynamic-import pattern as the subscribers (ESM-only core packages, CommonJS plugin build).
 */
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import type { MedusaContainer } from "@medusajs/framework";
import type { Amount, IsoDate } from "@normwerk/einvoice-model" with {
  "resolution-mode": "import",
};
import type EinvoiceModuleService from "../modules/einvoice/service.js";
import type { EinvoiceDocumentRecord } from "../modules/einvoice/service.js";
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
  type MedusaOrderForInvoice,
  UNALLOCATED_DOCUMENT_NUMBER,
} from "../mapping/order-to-commerce-invoice-input.js";
import {
  PartialCreditAcrossRatesError,
  extractGrandTotalFromCii,
  extractIssueDateFromCii,
  toPartialCreditNoteInput,
  type CreditScope,
} from "../mapping/credit-note.js";

/** The original invoice a credit note corrects, with what has already been credited against it. */
export interface CreditBasis {
  readonly invoice: EinvoiceDocumentRecord;
  readonly invoiceIssueDate: IsoDate;
  readonly invoiceTotal: Amount;
  readonly creditedTotals: readonly Amount[];
  /** P-63: what the buyer overpaid by the invoice's notice (`VAT_OVERCHARGED`) — `"0.00"` without one. */
  readonly overpaid: Amount;
}

/** Reads the order's invoice and credit notes back from the File Module. `undefined` when the order has
 * no invoice from this plugin. */
export async function loadCreditBasis(
  container: MedusaContainer,
  einvoiceService: EinvoiceModuleService,
  orderId: string,
): Promise<CreditBasis | undefined> {
  const invoices = await einvoiceService.listEinvoiceDocuments({
    type: "invoice",
    order_id: orderId,
  });
  const invoice = invoices[0] as EinvoiceDocumentRecord | undefined;
  if (invoice === undefined) {
    return undefined;
  }
  const invoiceXml = Buffer.from(await fetchFileBytes(container, invoice.xml_file_id)).toString(
    "utf-8",
  );
  const creditNotes = (await einvoiceService.listEinvoiceDocuments({
    type: "credit_note",
    order_id: orderId,
  })) as EinvoiceDocumentRecord[];
  const creditedTotals: Amount[] = [];
  for (const creditNote of creditNotes) {
    const xml = Buffer.from(await fetchFileBytes(container, creditNote.xml_file_id)).toString(
      "utf-8",
    );
    creditedTotals.push(extractGrandTotalFromCii(xml));
  }
  return {
    invoice,
    invoiceIssueDate: extractIssueDateFromCii(invoiceXml),
    invoiceTotal: extractGrandTotalFromCii(invoiceXml),
    creditedTotals,
    overpaid: invoice.notice?.code === "VAT_OVERCHARGED" ? invoice.notice.refundDue : "0.00",
  };
}

/** About a cent for each independently rounded amount — the same allowance as the invoice total check. */
export function creditTolerance(order: MedusaOrderForInvoice): Amount {
  return (0.01 * (order.items.length + (order.shipping_methods?.length ?? 0) + 1)).toFixed(2);
}

export interface IssueCreditNoteInput {
  readonly container: MedusaContainer;
  readonly einvoiceService: EinvoiceModuleService;
  readonly order: MedusaOrderForInvoice;
  readonly basis: CreditBasis;
  readonly scope: Exclude<CreditScope, { kind: "none" }>;
  /** Per refund id, or per cancelled order — the `(credit_note, key)` pair is unique. */
  readonly idempotencyKey: string;
  readonly reason: "refund" | "cancellation";
  /** Webbers mode only: their credit invoice's `resource_id` (a refund id) whose number is reused. */
  readonly webbersResourceId?: string;
  /** Webbers mode only: `false` when their credit invoice shows another amount than this credit note — it
   * then gets their number but not their PDF (P-63: a refund that returns an overpayment first). */
  readonly embedWebbersPdf?: boolean;
}

export async function issueCreditNote({
  container,
  einvoiceService,
  order,
  basis,
  scope,
  idempotencyKey,
  reason,
  webbersResourceId,
  embedWebbersPdf = true,
}: IssueCreditNoteInput): Promise<void> {
  const commerce = await import("@normwerk/einvoice-commerce");
  const cii = await import("@normwerk/einvoice-cii");
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);

  const now = () => einvoiceService.options.now?.() ?? new Date();
  const issueDate = issueDateInSellerTimeZone(einvoiceService.options.seller.countryCode, now());

  let input = mapOrderToCommerceInvoiceInput(order, {
    seller: einvoiceService.options.seller,
    kind: "credit-note",
    issueDate,
    payment: einvoiceService.options.payment,
    ossRegistered: einvoiceService.options.ossRegistered,
    correctedInvoice: { number: basis.invoice.document_number, issueDate: basis.invoiceIssueDate },
  });

  const profile = commerce.selectProfile({
    buyerCountry: input.buyer.countryCode,
    leitwegId: input.references?.leitwegId,
    preferredProfile: einvoiceService.options.defaultProfile,
  });

  // VAT-ID verification is I/O and happens before buildInvoice (ADR-003) — and before a number is taken.
  const vatIdEvidence =
    einvoiceService.options.vatIdVerifier !== undefined && input.taxContext.buyerVatId !== undefined
      ? await einvoiceService.options.vatIdVerifier.verify(input.taxContext.buyerVatId, now())
      : undefined;

  if (scope.kind === "partial") {
    const decision = commerce.decideVatCategory(input.taxContext, vatIdEvidence);
    const taxContext = input.taxContext;
    const rates = new Set(
      input.lines.map((line) =>
        commerce.resolveLineRate(decision, taxContext, line.taxRateKind, line.chargedVatRate),
      ),
    );
    if (rates.size > 1) {
      throw new PartialCreditAcrossRatesError(order.id);
    }
    input = toPartialCreditNoteInput(input, {
      gross: scope.gross,
      taxRateKind: input.lines[0]?.taxRateKind,
      chargedVatRate: input.lines[0]?.chargedVatRate,
      originalInvoiceNumber: basis.invoice.document_number,
      reason,
    });
  }

  const buildOptions = vatIdEvidence === undefined ? {} : { vatIdEvidence };
  // P-48: refusals before a document number is taken — see invoice-on-fulfillment-created.ts.
  commerce.buildInvoice(
    { ...input, document: { ...input.document, number: UNALLOCATED_DOCUMENT_NUMBER } },
    buildOptions,
  );

  const integration = einvoiceService.options.integration;
  let documentNumber: string;
  let basePdfBytes: Uint8Array | undefined;

  if (integration?.kind === "webbers") {
    if (webbersResourceId === undefined) {
      throw new WebbersInvoiceNotFoundError(order.id, order.id, "credit");
    }
    const webbersInvoice = await waitForWebbersInvoice(container, order.id, {
      resourceId: webbersResourceId,
      type: "credit",
      timeoutMs: integration.waitForInvoiceMs,
      pollIntervalMs: integration.pollIntervalMs,
    });
    if (webbersInvoice === undefined) {
      throw new WebbersInvoiceNotFoundError(order.id, webbersResourceId, "credit");
    }
    documentNumber = String(webbersInvoice.invoice.display_id);
    if (webbersInvoice.invoice.pdf_url !== null && embedWebbersPdf) {
      basePdfBytes = await fetchWebbersPdfBytes(container, webbersInvoice.invoice.pdf_url);
    }
  } else {
    const numberer = new commerce.SequentialNumberer(new ModuleNumberingStore(einvoiceService));
    documentNumber = await numberer.next({ kind: "credit-note", issueDate });
  }

  const buildResult = commerce.buildInvoice(
    { ...input, document: { ...input.document, number: documentNumber } },
    buildOptions,
  );

  for (const warning of buildResult.warnings) {
    logger.warn(`einvoice: order ${order.id}: ${warning.message} [${warning.code}]`);
  }

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
    idempotencyKey,
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
