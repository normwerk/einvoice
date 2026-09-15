/**
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
 * keeping `SequentialNumberer`'s "gap-free" guarantee (`numbering.ts`) intact for the realistic redelivery
 * case (Medusa's local event bus never retries by default — `docs/domain-glossary.md` — so a genuine
 * redelivery here means a manual replay/retry, which is sequential, not concurrent, with the original
 * delivery). `recordDocumentIfAbsent`'s own database-level `UNIQUE` guard (`service.ts`) is the backstop
 * for the narrower case this check alone can't cover: two literally concurrent deliveries of the same
 * event both passing this check before either has inserted — a real edge case worth naming rather than
 * silently assuming away, not one this plugin's local event bus can actually produce today.
 *
 * T-072: `einvoiceService.options.integration?.kind === "webbers"` reuses `@webbers/invoices-medusa`'s own
 * invoice `display_id` instead of allocating a number here at all ("не дублировать нумерацию",
 * plan-v0.1 §4.6) — see `integrations/webbers.ts` for the real, structural reason this needs a poll/wait
 * rather than a plain read (their workflow defines no `createHook()`, and Medusa's local event bus starts
 * every subscriber of the same event without waiting for any of them to finish). When their own PDF is
 * available, this plugin's XML is embedded into it as PDF/A-3 (`embedInvoiceInPdfA3`, `@normwerk/einvoice-pdfa`,
 * T-030) instead of shipping bare XML.
 *
 * T-073: standalone mode's (`integration` omitted) own equivalent of that same "XML + PDF/A-3" outcome —
 * `einvoiceService.options.standalone?.basePdf` is called with the built `Invoice` once numbering has been
 * resolved, and its return value (or `undefined`, for pure XML) is embedded the same way Webbers' own PDF
 * would be — `basePdfBytes` below is deliberately the same variable regardless of which of the two sources
 * it came from, since `embedInvoiceInPdfA3` itself doesn't care.
 */
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework";
import { EINVOICE_MODULE } from "../modules/einvoice/index.js";
import type EinvoiceModuleService from "../modules/einvoice/service.js";
import { ModuleNumberingStore } from "../modules/einvoice/numbering-store.js";
import {
  fetchWebbersPdfBytes,
  waitForWebbersInvoice,
  WebbersInvoiceNotFoundError,
} from "../integrations/webbers.js";
import {
  mapOrderToCommerceInvoiceInput,
  ORDER_QUERY_FIELDS,
  resolveB2gBuyerReference,
  type MedusaOrderForInvoice,
} from "../mapping/order-to-commerce-invoice-input.js";

interface FulfillmentCreatedEventData {
  readonly order_id: string;
  readonly fulfillment_id: string;
  readonly no_notification?: boolean | null;
}

export default async function invoiceOnFulfillmentCreated({
  event: { data },
  container,
}: SubscriberArgs<FulfillmentCreatedEventData>): Promise<void> {
  const einvoiceService = container.resolve<EinvoiceModuleService>(EINVOICE_MODULE);

  const existing = await einvoiceService.listEinvoiceDocuments({
    type: "invoice",
    idempotency_key: data.fulfillment_id,
  });
  if (existing.length > 0) {
    return;
  }

  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const { data: orders } = await query.graph({
    entity: "order",
    filters: { id: data.order_id },
    fields: ORDER_QUERY_FIELDS as unknown as string[],
  });
  const order = orders[0] as MedusaOrderForInvoice | undefined;
  if (order === undefined) {
    // The order is gone by the time this subscriber runs (async delivery) — nothing to invoice, and
    // there's nothing to retry into existing either.
    return;
  }

  const commerce = await import("@normwerk/einvoice-commerce");
  const cii = await import("@normwerk/einvoice-cii");

  const issueDate = new Date().toISOString().slice(0, 10);

  const input = mapOrderToCommerceInvoiceInput(order, {
    seller: einvoiceService.options.seller,
    kind: "invoice",
    issueDate,
    deRates: { standard: commerce.DE_STANDARD_RATE, reduced: commerce.DE_REDUCED_RATE },
    payment: einvoiceService.options.payment,
  });

  // The *raw* B2G signal, not `input.references.buyerReference` — that field is always populated (BR-DE-15,
  // `mapOrderToCommerceInvoiceInput`'s own doc comment), and feeding it back into `selectProfile` here
  // would make every order resolve to XRECHNUNG regardless of `defaultProfile`.
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
      resourceId: order.id,
      type: "debit",
      timeoutMs: integration.waitForInvoiceMs,
      pollIntervalMs: integration.pollIntervalMs,
    });
    if (webbersInvoice === undefined) {
      throw new WebbersInvoiceNotFoundError(order.id, order.id, "debit");
    }
    documentNumber = String(webbersInvoice.invoice.display_id);
    if (webbersInvoice.invoice.pdf_url !== null) {
      basePdfBytes = await fetchWebbersPdfBytes(container, webbersInvoice.invoice.pdf_url);
    }
  } else {
    const numberer = new commerce.SequentialNumberer(new ModuleNumberingStore(einvoiceService));
    documentNumber = await numberer.next({ kind: "invoice", issueDate });
  }

  const buildResult = commerce.buildInvoice({
    ...input,
    document: { ...input.document, number: documentNumber },
  });

  // T-073: standalone mode's own PDF source — see this file's own doc comment. Webbers mode already
  // resolved `basePdfBytes` (or left it `undefined`) above; this only runs for the other branch.
  if (integration?.kind !== "webbers") {
    basePdfBytes = await einvoiceService.options.standalone?.basePdf?.(buildResult.invoice);
  }

  const ciiProfile = profile === "XRECHNUNG" ? "xrechnung-3.0-cii" : "en16931-cii";
  const { xml } = cii.serializeCii(buildResult.invoice, { profile: ciiProfile });

  let pdfBase64: string | null = null;
  if (basePdfBytes !== undefined) {
    const pdfa = await import("@normwerk/einvoice-pdfa");
    const { pdfBytes } = await pdfa.embedInvoiceInPdfA3(basePdfBytes, xml, {
      profile,
      title: documentNumber,
    });
    pdfBase64 = Buffer.from(pdfBytes).toString("base64");
  }

  await einvoiceService.recordDocumentIfAbsent({
    type: "invoice",
    orderId: order.id,
    idempotencyKey: data.fulfillment_id,
    documentNumber,
    xml,
    pdf: pdfBase64,
  });
}

export const config: SubscriberConfig = {
  event: "order.fulfillment_created",
};
