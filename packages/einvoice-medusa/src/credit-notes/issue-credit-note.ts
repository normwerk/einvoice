/**
 * P-41: issuing a credit note (381) against an invoice this plugin generated — shared by the refund
 * subscriber (`payment.refunded`) and the cancellation subscriber (`order.canceled`). Lives outside
 * `src/subscribers/` on purpose: Medusa loads every file there as a subscriber.
 *
 * What a credit note contains is decided by `decideCreditScope` (`mapping/credit-note.ts`): the whole
 * order restated, or one VAT-inclusive line over a credited gross sum. Its VAT category and rate always
 * come from `@normwerk/einvoice-commerce` (`decideVatCategory`, and `buildInvoice` for the rate the VAT
 * is taken out at) — this file asks, it does not decide. The VAT-ID check and the partial-credit refusal run before a document number is
 * allocated, so neither burns a number. P-66: a refusal there is recorded (`refusals.ts`) rather than thrown
 * — shown in the admin, and retried by redelivering the event named in `trigger`.
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
import { deleteEinvoiceFiles, fetchFileBytes, storeEinvoiceFiles } from "../storage.js";
import { recordRefusalOfError, type CreditNoteTrigger } from "../refusals.js";
import { emitDocumentIssued } from "../events.js";
import type { EinvoiceRefusalRecord } from "../modules/einvoice/service.js";
import {
  issueDateInSellerTimeZone,
  mapOrderToCommerceInvoiceInput,
  type MedusaOrderForInvoice,
  type ShipmentScope,
  UNALLOCATED_DOCUMENT_NUMBER,
} from "../mapping/order-to-commerce-invoice-input.js";
import {
  extractGrandTotalFromCii,
  extractGrossByRateFromCii,
  extractIssueDateFromCii,
  rateKey,
  returnsToCredit,
  decideCreditScope,
  toPartialCreditNoteInput,
  type CreditScope,
  type MedusaReturnForCredit,
  type PartialCreditNoteLine,
} from "../mapping/credit-note.js";
import { taxEvidenceToKeep } from "../mapping/tax-evidence.js";
import type { CoveredReturn, InvoicedLine } from "../modules/einvoice/service.js";

/** The original invoice a credit note corrects, with what has already been credited against it. */
export interface CreditBasis {
  readonly invoice: EinvoiceDocumentRecord;
  readonly invoiceIssueDate: IsoDate;
  readonly invoiceTotal: Amount;
  readonly creditedTotals: readonly Amount[];
  /** P-63: what the buyer overpaid by the invoice's notice (`VAT_OVERCHARGED`) — `"0.00"` without one. */
  readonly overpaid: Amount;
  /** P-65: per rate, what the invoice charged less what its credit notes credited — gross. */
  readonly uncreditedByRate: readonly { readonly rate: string; readonly gross: Amount }[];
  /** P-65: the parts of received returns earlier credit notes paid for. */
  readonly coveredReturns: readonly CoveredReturn[];
  /** P-65: what the invoice stated for each order line — what a returned unit is credited at. */
  readonly invoicedLines: readonly InvoicedLine[];
}

/** P-67: the order's invoices — one per fulfillment. */
export async function listOrderInvoices(
  einvoiceService: EinvoiceModuleService,
  orderId: string,
): Promise<readonly EinvoiceDocumentRecord[]> {
  return (await einvoiceService.listEinvoiceDocuments(
    { type: "invoice", order_id: orderId },
    { order: { created_at: "ASC" } },
  )) as unknown as EinvoiceDocumentRecord[];
}

/** Reads one invoice and the credit notes that correct it back from the File Module (P-67: an order can
 * have several invoices; a credit note names the one it corrects). */
export async function loadCreditBasis(
  container: MedusaContainer,
  einvoiceService: EinvoiceModuleService,
  invoice: EinvoiceDocumentRecord,
): Promise<CreditBasis> {
  const invoiceXml = Buffer.from(await fetchFileBytes(container, invoice.xml_file_id)).toString(
    "utf-8",
  );
  const orderCreditNotes = (await einvoiceService.listEinvoiceDocuments({
    type: "credit_note",
    order_id: invoice.order_id,
  })) as unknown as EinvoiceDocumentRecord[];
  const creditNotes = orderCreditNotes.filter(
    (creditNote) => creditNote.corrected_document_id === invoice.id,
  );
  const creditedTotals: Amount[] = [];
  const uncreditedCents = new Map<string, number>(
    extractGrossByRateFromCii(invoiceXml).map((entry) => [
      entry.rate,
      Math.round(Number(entry.gross) * 100),
    ]),
  );
  for (const creditNote of creditNotes) {
    const xml = Buffer.from(await fetchFileBytes(container, creditNote.xml_file_id)).toString(
      "utf-8",
    );
    creditedTotals.push(extractGrandTotalFromCii(xml));
    for (const entry of extractGrossByRateFromCii(xml)) {
      uncreditedCents.set(
        entry.rate,
        (uncreditedCents.get(entry.rate) ?? 0) - Math.round(Number(entry.gross) * 100),
      );
    }
  }
  return {
    invoice,
    invoiceIssueDate: extractIssueDateFromCii(invoiceXml),
    invoiceTotal: extractGrandTotalFromCii(invoiceXml),
    creditedTotals,
    overpaid: invoice.notice?.code === "VAT_OVERCHARGED" ? invoice.notice.refundDue : "0.00",
    uncreditedByRate: [...uncreditedCents.entries()].map(([rate, cents]) => ({
      rate,
      gross: (Math.max(0, cents) / 100).toFixed(2),
    })),
    // A received return is paid for once across the order, whichever invoice it was credited on.
    coveredReturns: orderCreditNotes.flatMap((creditNote) => creditNote.covered_returns ?? []),
    invoicedLines: invoice.line_values ?? [],
  };
}

/** P-67: what an invoice covered, for a credit note that restates it — its lines, units and discount
 * shares, and the shipping if it carried it. An invoice without stored lines restates the whole order. */
function invoiceShipment(
  invoice: EinvoiceDocumentRecord,
  deliveryDate: IsoDate,
): ShipmentScope | undefined {
  const lines = invoice.line_values ?? [];
  if (lines.length === 0) return undefined;
  return {
    lines: lines.map((line) => ({
      itemId: line.itemId,
      quantity: line.quantity,
      allowance: line.allowance ?? "0.00",
    })),
    includesShipping: invoice.includes_shipping,
    deliveryDate,
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
  /** P-66: what a retry of a refused credit note redelivers. */
  readonly trigger: CreditNoteTrigger;
}

/** P-65: the order's returns — what a partial credit pays for first. Queried as returns, not through the
 * order: `order.returns.items` comes back without `received_quantity` (checked on Medusa 2.21), which the
 * return entity itself does return. */
export async function loadReturnsForCredit(
  container: MedusaContainer,
  orderId: string,
): Promise<readonly MedusaReturnForCredit[]> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const { data } = await query.graph({
    entity: "return",
    filters: { order_id: orderId },
    fields: [
      "id",
      "status",
      "received_at",
      "created_at",
      "items.item_id",
      "items.received_quantity",
    ],
  });
  return data as MedusaReturnForCredit[];
}

export type IssueCreditNoteOutcome =
  | { readonly kind: "issued"; readonly documentNumber: string }
  /** Lost a concurrent insert — another delivery issued it. */
  | { readonly kind: "exists" }
  /** Refused before a number was taken (P-66); the refusal is recorded. */
  | { readonly kind: "blocked"; readonly refusal: EinvoiceRefusalRecord; readonly message: string };

export async function issueCreditNote({
  container,
  einvoiceService,
  order,
  basis,
  scope,
  idempotencyKey,
  reason,
  trigger,
}: IssueCreditNoteInput): Promise<IssueCreditNoteOutcome> {
  const commerce = await import("@normwerk/einvoice-commerce");
  const cii = await import("@normwerk/einvoice-cii");
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);

  const now = () => einvoiceService.options.now?.() ?? new Date();
  const issueDate = issueDateInSellerTimeZone(einvoiceService.options.seller.countryCode, now());

  const refused = async (error: unknown): Promise<IssueCreditNoteOutcome> => ({
    kind: "blocked",
    ...(await recordRefusalOfError(
      container,
      einvoiceService,
      { type: "credit_note", orderId: order.id, idempotencyKey, trigger },
      error,
    )),
  });

  // P-66: everything up to the check build can refuse the credit note — recorded, not thrown.
  const prepare = async () => {
    let input = mapOrderToCommerceInvoiceInput(order, {
      seller: einvoiceService.options.seller,
      kind: "credit-note",
      issueDate,
      payment: einvoiceService.options.payment,
      ossRegistered: einvoiceService.options.ossRegistered,
      shipment: invoiceShipment(basis.invoice, issueDate),
      correctedInvoice: {
        number: basis.invoice.document_number,
        issueDate: basis.invoiceIssueDate,
      },
    });

    const profile = commerce.selectProfile({
      buyerCountry: input.buyer.countryCode,
      leitwegId: input.references?.leitwegId,
      preferredProfile: einvoiceService.options.defaultProfile,
    });

    // T-192 (P-73): the credit note corrects the invoice's supply, so it follows the decision stored with that
    // invoice — and the VIES answer it rested on — instead of deciding again on today's facts: VIES, the
    // plugin options and the order's address may all have changed since. An invoice issued before decisions
    // were kept is decided again, with a fresh VIES check, as before.
    const invoiceDecisions = basis.invoice.tax_decisions ?? [];
    const correctedInvoiceDecision =
      invoiceDecisions.length === 1 && invoiceDecisions[0]?.scope.kind === "document"
        ? invoiceDecisions[0]
        : undefined;
    // VAT-ID verification is I/O and happens before buildInvoice (ADR-003) — and before a number is taken.
    const vatIdEvidence =
      correctedInvoiceDecision !== undefined
        ? (basis.invoice.vat_id_evidence ?? undefined)
        : einvoiceService.options.vatIdVerifier !== undefined &&
            input.taxContext.buyerVatId !== undefined
          ? await einvoiceService.options.vatIdVerifier.verify(input.taxContext.buyerVatId, now())
          : undefined;

    // P-65: a partial credit states what it credits at each rate — received returns first, at their own
    // rates; the rest in proportion to what is still uncredited per rate (`allocateCreditAcrossRates`).
    let coveredReturns: CoveredReturn[] = [];
    if (scope.kind === "partial") {
      const decision =
        correctedInvoiceDecision ?? commerce.decideVatCategory(input.taxContext, vatIdEvidence);
      const taxContext = input.taxContext;
      const lineRates = input.lines.map((line) =>
        rateKey(
          commerce.resolveLineRate(decision, taxContext, line.taxRateKind, line.chargedVatRate),
        ),
      );
      const received = await loadReturnsForCredit(container, order.id);
      const pieces = commerce.allocateCreditAcrossRates({
        amount: scope.gross,
        returns: returnsToCredit(received, basis.invoicedLines, basis.coveredReturns),
        uncreditedByRate: basis.uncreditedByRate,
      });
      const restLabel =
        reason === "cancellation"
          ? "Stornierung Restbetrag / Cancellation of the remaining amount"
          : "Teilerstattung / Partial refund";
      const restRates = new Set(
        pieces.filter((piece) => piece.returnId === undefined).map((piece) => rateKey(piece.rate)),
      );
      const lines: PartialCreditNoteLine[] = [];
      for (const kind of ["return", "rest"] as const) {
        for (const rate of [...new Set(lineRates)]) {
          const cents = pieces
            .filter(
              (piece) =>
                rateKey(piece.rate) === rate &&
                (kind === "return") === (piece.returnId !== undefined),
            )
            .reduce((sum, piece) => sum + Math.round(Number(piece.gross) * 100), 0);
          if (cents === 0) continue;
          const line = input.lines[lineRates.indexOf(rate)];
          lines.push({
            gross: (cents / 100).toFixed(2),
            taxRateKind: line?.taxRateKind,
            chargedVatRate: line?.chargedVatRate,
            label:
              kind === "return"
                ? "Rückgabe / Return"
                : restRates.size > 1
                  ? `${restLabel} (anteilig ${rate} %)`
                  : restLabel,
          });
        }
      }
      coveredReturns = pieces.flatMap((piece) =>
        piece.returnId === undefined
          ? []
          : [{ returnId: piece.returnId, rate: rateKey(piece.rate), gross: piece.gross }],
      );
      input = toPartialCreditNoteInput(input, lines, basis.invoice.document_number);
    }

    const buildOptions = {
      ...(vatIdEvidence === undefined ? {} : { vatIdEvidence }),
      ...(correctedInvoiceDecision === undefined ? {} : { correctedInvoiceDecision }),
    };
    // P-48: refusals before a document number is taken — see invoices/issue-invoice.ts.
    commerce.buildInvoice(
      { ...input, document: { ...input.document, number: UNALLOCATED_DOCUMENT_NUMBER } },
      buildOptions,
    );
    return { input, profile, buildOptions, coveredReturns };
  };
  let prepared: Awaited<ReturnType<typeof prepare>>;
  try {
    prepared = await prepare();
  } catch (error) {
    return refused(error);
  }
  const { input, profile, buildOptions, coveredReturns } = prepared;

  const numberer = new commerce.SequentialNumberer(new ModuleNumberingStore(einvoiceService));
  const documentNumber = await numberer.next({ kind: "credit-note", issueDate });

  const buildResult = commerce.buildInvoice(
    { ...input, document: { ...input.document, number: documentNumber } },
    buildOptions,
  );

  for (const warning of buildResult.warnings) {
    logger.warn(`einvoice: order ${order.id}: ${warning.message} [${warning.code}]`);
  }

  // T-073: the merchant's own PDF, if any — see `invoices/issue-invoice.ts`.
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
    type: "credit_note",
    orderId: order.id,
    idempotencyKey,
    documentNumber,
    xmlFileId: stored.xmlFileId,
    pdfFileId: stored.pdfFileId,
    coveredReturns: coveredReturns.length > 0 ? coveredReturns : null,
    correctedDocumentId: basis.invoice.id,
    // T-192: the VIES answer a K credit note rests on, and the rule it followed.
    ...taxEvidenceToKeep(buildResult),
  });

  if (!result.created) {
    // Same lost-race cleanup as invoice-on-fulfillment-created.ts's identical branch.
    await deleteEinvoiceFiles(
      container,
      stored.pdfFileId === null ? [stored.xmlFileId] : [stored.xmlFileId, stored.pdfFileId],
    );
    return { kind: "exists" };
  }
  await einvoiceService.clearRefusal("credit_note", idempotencyKey);
  // P-71: after the document is written. A refund's credit note is keyed by the refund's id.
  await emitDocumentIssued(container, {
    id: result.document.id,
    order_id: order.id,
    type: "credit_note",
    document_number: documentNumber,
    ...(reason === "refund" ? { refund_id: idempotencyKey } : {}),
  });
  return { kind: "issued", documentNumber };
}

export interface CreditRemainderRequest {
  /** Per cancelled fulfillment, or per invoice of a cancelled order — the `(credit_note, key)` pair is unique. */
  readonly idempotencyKey: string;
  readonly trigger: CreditNoteTrigger;
}

/**
 * P-67: credits what is left of one invoice — a cancelled fulfillment's, or each invoice of a cancelled order:
 * the whole invoice restated when nothing was credited before, otherwise one line per rate over the rest
 * (`decideCreditScope`). `undefined` when there is nothing left, or the key already has its credit note.
 */
export async function creditInvoiceRemainder(
  container: MedusaContainer,
  einvoiceService: EinvoiceModuleService,
  order: MedusaOrderForInvoice,
  invoice: EinvoiceDocumentRecord,
  { idempotencyKey, trigger }: CreditRemainderRequest,
): Promise<IssueCreditNoteOutcome | undefined> {
  const existing = await einvoiceService.listEinvoiceDocuments({
    type: "credit_note",
    idempotency_key: idempotencyKey,
  });
  if (existing.length > 0) {
    return undefined;
  }
  const basis = await loadCreditBasis(container, einvoiceService, invoice);
  const scope = decideCreditScope({
    requested: basis.invoiceTotal,
    invoiceTotal: basis.invoiceTotal,
    creditedTotals: basis.creditedTotals,
    tolerance: creditTolerance(order),
  });
  if (scope.kind === "none") {
    return undefined;
  }
  return issueCreditNote({
    container,
    einvoiceService,
    order,
    basis,
    scope,
    idempotencyKey,
    reason: "cancellation",
    trigger,
  });
}
