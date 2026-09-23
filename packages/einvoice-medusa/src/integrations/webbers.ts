/**
 * T-072: real integration with `@webbers/invoices-medusa` (npm, MIT) — plan-v0.1's own named target for
 * "on top of a PDF plugin" mode (§4.6): reuse their invoice's own `display_id` (BT-1) instead of
 * allocating one of this plugin's own numbers ("не дублировать нумерацию"), and, when their PDF is
 * available, embed our own XML into it as a PDF/A-3 hybrid rather than shipping bare XML.
 *
 * The real, structural constraint T-070/T-071 both flagged as unresolved is closed here, not guessed at:
 * their `createInvoiceWorkflow`/`createCreditInvoiceWorkflow` define no `createHook()`, and Medusa's own
 * local event bus fires every subscriber of the same event without awaiting any of them before starting
 * the next (`@medusajs/event-bus-local`'s own compiled `groupOrEmitEvent`: `this.eventEmitter_.emit(...)`
 * is a synchronous Node `EventEmitter.emit`, which calls each listener but does not wait for the promise an
 * `async` listener returns) — so there is no ordering guarantee between this plugin's own subscriber and
 * theirs, confirmed by reading their compiled source, not assumed from "no hook exists". `waitForInvoice`
 * below polls for their invoice to appear instead of assuming either order.
 *
 * `@webbers/invoices-medusa@1.0.6`'s own `package.json` declares a `"./links"` export subpath pointing at
 * `.medusa/server/src/links/index.js` — that file does not exist in the published tarball (only
 * `links/invoice-order.js` itself does, no barrel file). The wildcard `"./*"` export subpath still resolves
 * `@webbers/invoices-medusa/links/invoice-order` to the real file, which is what this module imports — a
 * real packaging gap in their plugin (verified by inspecting the actual published tarball), not a guess at
 * an alternate import path.
 */
import type { MedusaContainer } from "@medusajs/framework";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { fetchFileBytes } from "../storage.js";

export class WebbersInvoiceNotFoundError extends Error {
  constructor(
    readonly orderId: string,
    readonly resourceId: string,
    readonly type: "debit" | "credit",
  ) {
    super(
      `No @webbers/invoices-medusa ${type} invoice for resource ${resourceId} (order ${orderId}) appeared ` +
        "within the configured wait window. This plugin refuses to allocate its own document number in " +
        'integration.kind === "webbers" mode, so that one order never carries two different invoice ' +
        "numbers — increase " +
        "integration.waitForInvoiceMs if their workflow genuinely needs longer, or check their own logs for " +
        "a failure in createInvoiceWorkflow/createCreditInvoiceWorkflow.",
    );
    this.name = "WebbersInvoiceNotFoundError";
  }
}

export class WebbersNotInstalledError extends Error {
  constructor(readonly cause: unknown) {
    super(
      'einvoiceModuleOptions.integration.kind is "webbers" but @webbers/invoices-medusa\'s own link ' +
        'module ("@webbers/invoices-medusa/links/invoice-order") could not be imported — is the plugin ' +
        "actually installed alongside @normwerk/einvoice-medusa?",
    );
    this.name = "WebbersNotInstalledError";
  }
}

/** Mirrors `@webbers/invoices-medusa`'s own `Invoice` DML model fields this plugin actually reads
 * (`modules/invoice/models/invoice.js`, inspected directly from the published npm tarball) — not the
 * whole model, only what `waitForInvoice`'s callers need. */
export interface WebbersInvoice {
  readonly invoice_id: string;
  readonly invoice: {
    readonly display_id: number;
    readonly type: "debit" | "credit" | "void";
    readonly resource_id: string;
    readonly pdf_url: string | null;
  };
}

interface WebbersInvoiceOrderLink {
  readonly entryPoint: string;
}

/**
 * A dynamic `import()` of `@webbers/invoices-medusa` (a CommonJS package, like this plugin itself) is a
 * genuinely different case from this plugin's own established "dynamic-import an ESM package from CJS"
 * pattern (`invoice-on-fulfillment-created.ts`'s own doc comment) — that one needs a dynamic import at all
 * *because* the target is ESM-only; here, dynamically importing another *CommonJS* module through Node's
 * ESM loader triggers Node's own CJS/ESM interop wrapping, which double-wraps the default export: their
 * compiled `links/invoice-order.js` does `exports.default = defineLink(...)` (confirmed by reading it
 * directly), so `module.exports` itself is `{ __esModule: true, default: <the real link object> }` —
 * Node's synthetic ESM namespace for a required CJS module sets `namespace.default = module.exports`
 * *whole*, not `module.exports.default`, so the real value ends up at `mod.default.default`, not
 * `mod.default`. Confirmed empirically (a temporary debug route logging the actual awaited value during
 * this task's own e2e run — `mod.default` printed as `{ default: { entryPoint: "invoice_order", ... } }`),
 * not assumed from Node's interop docs alone. Unwrapping defensively (`?? mod.default`) also keeps this
 * working unmodified if a future version of their plugin ships real ESM.
 */
async function loadWebbersInvoiceOrderLink(): Promise<WebbersInvoiceOrderLink> {
  try {
    const mod = (await import("@webbers/invoices-medusa/links/invoice-order")) as {
      readonly default: WebbersInvoiceOrderLink | { readonly default: WebbersInvoiceOrderLink };
    };
    const unwrapped =
      "entryPoint" in mod.default
        ? mod.default
        : (mod.default as { readonly default: WebbersInvoiceOrderLink }).default;
    return unwrapped;
  } catch (error) {
    throw new WebbersNotInstalledError(error);
  }
}

export interface WaitForInvoiceOptions {
  /** Matches `resource_id` on their `Invoice` model — the order id for a debit invoice, the refund id for
   * a credit invoice (their own `create-credit-invoice` workflow's convention, mirrored here rather than
   * invented). */
  readonly resourceId: string;
  readonly type: "debit" | "credit";
  /** Total time to keep polling before giving up, ms. Default 10s — generous relative to their own
   * workflow's real work (a DB write plus PDF rendering plus a File Module upload), not tuned to any
   * specific measured duration (none is documented by them). */
  readonly timeoutMs?: number | undefined;
  readonly pollIntervalMs?: number | undefined;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_POLL_INTERVAL_MS = 500;

/**
 * Polls `@webbers/invoices-medusa`'s own `invoice_order` link for an invoice matching `resourceId`/`type`,
 * returning it once found or `undefined` once `timeoutMs` elapses. This is the real, honest answer to the
 * "no `createHook()`" gap — not a guess that their subscriber always finishes first.
 */
export async function waitForWebbersInvoice(
  container: MedusaContainer,
  orderId: string,
  options: WaitForInvoiceOptions,
): Promise<WebbersInvoice | undefined> {
  const link = await loadWebbersInvoiceOrderLink();
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    const { data: links } = await query.graph({
      entity: link.entryPoint,
      filters: { order_id: orderId },
      fields: [
        "invoice_id",
        "invoice.display_id",
        "invoice.type",
        "invoice.resource_id",
        "invoice.pdf_url",
      ],
    });
    const match = (links as readonly WebbersInvoice[]).find(
      (l) => l.invoice?.type === options.type && l.invoice?.resource_id === options.resourceId,
    );
    if (match !== undefined) {
      return match;
    }
    if (Date.now() >= deadline) {
      return undefined;
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
}

/**
 * Downloads the PDF bytes their `uploadInvoicePdfStep` stored in the File Module — `pdf_url` is, despite
 * its name, a File Module file id, not a real URL (`workflows/steps/upload-invoice-pdf-step.js`:
 * `invoiceModule.updateInvoices({ id, pdf_url: file.id })`); `fileModuleService.retrieveFile(id)` returns a
 * presigned download URL that still needs fetching, confirmed against the real compiled
 * `@medusajs/file` module service. T-074 extracted this two-step shape into `storage.ts`'s own
 * `fetchFileBytes` (this plugin's own files need the exact same read-back once T-074 stores them in the
 * File Module too) — kept as a thin, named wrapper here rather than inlined at each call site, since
 * "Webbers' PDF" is a meaningfully different thing to read than "our own document's file" even though the
 * mechanism is identical.
 */
export async function fetchWebbersPdfBytes(
  container: MedusaContainer,
  pdfFileId: string,
): Promise<Uint8Array> {
  return fetchFileBytes(container, pdfFileId);
}
