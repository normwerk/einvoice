/**
 * T-214 (D-61): the dry-run report — what a platform plugin would have done with a shop's orders had it been
 * running, without issuing anything: no document number taken, no file stored, no event sent. A platform's
 * dry-run command writes it as JSON; `markdown.ts` renders it for a merchant or a partner to read.
 * Platform-neutral: the Medusa plugin writes it first, the Vendure one later. `__fixtures__/example-report.ts`
 * shows it filled in.
 *
 * Two steps, so that no shipped package depends on this one (AGENTS.md §6): the plugin writes a folder with
 * `report.json` — every document's validation `not-run` — and `xml/<fulfillment id>.xml` for each invoice it
 * would issue (the id with any character outside `A-Za-z0-9_-` as `_`, `validate.ts`'s `xmlFileName`); the XML
 * names the buyer and stays on that machine. `pnpm conformance dry-run <folder>` validates it and writes the
 * verdicts back into `report.json`, and `report.md`.
 *
 * Without personal data by construction (D-08, AGENTS.md §5.2): every field is an internal id, a count, a code,
 * a version, a hash, a validator rule id, a country code or a sentence fixed per code — never a name, an
 * address, a VAT-ID, an email address or an amount of an order. No field can carry free text from an order or
 * from an error's message; a check that needs to say more says it with a typed field, not a string.
 *
 * Five outcomes per document (D-61): the four classes of what the plugin would do, or cannot be judged to do,
 * and `tool-error` — the run itself failed, which is a defect and the reason the run exists.
 */

/** Raised when a field changes its meaning or goes away; an added optional field leaves it as it is. */
export const DRY_RUN_REPORT_SCHEMA_VERSION = 1;

export interface DryRunReport {
  readonly schemaVersion: typeof DRY_RUN_REPORT_SCHEMA_VERSION;
  readonly header: DryRunHeader;
  /** The shop's setup, checked before any order. */
  readonly preflight: readonly PreflightCheck[];
  /** Whether the documents' XML went through the validators, and which ones. */
  readonly validation: ValidationRun;
  /** One per document, in the order the run planned them: orders by creation, an order's fulfillments too. */
  readonly assessments: readonly Assessment[];
  /** What the run could not assess for the shop as a whole rather than for one document. */
  readonly runLimitations: readonly RunLimitationCode[];
}

export interface PackageVersion {
  readonly name: string;
  readonly version: string;
}

export interface DryRunHeader {
  /** When the run started, ISO 8601 in UTC to the second: `2026-10-07T12:00:00Z`. */
  readonly startedAt: string;
  /** The plugin that planned the documents. */
  readonly plugin: PackageVersion;
  /** The shop platform and its release: `{ "name": "Medusa", "version": "2.21.2" }`. */
  readonly platform: PackageVersion;
  readonly nodeVersion: string;
  /** The core packages the plugin decided and built the documents with, as installed in the shop. */
  readonly core: readonly PackageVersion[];
  /**
   * SHA-256 (hex) of the VAT rules the run applied: the installed `@normwerk/einvoice-commerce` modules that
   * hold them — the tax rules, Germany's VAT rate periods, the supported countries. The same version with
   * another hash is a patched package.
   */
  readonly rulesSha256: string;
  readonly scope: DryRunScope;
}

export type DryRunSelection =
  /** Every fulfillment created in a period: ISO dates, both days included. */
  | { readonly kind: "period"; readonly from: string; readonly to: string }
  /** The orders named when the run was started. */
  | { readonly kind: "orders"; readonly requested: number };

export interface DryRunScope {
  readonly selection: DryRunSelection;
  /** The orders the selection found. */
  readonly orders: number;
  /** Their fulfillments, the cancelled ones and the skipped ones included. */
  readonly fulfillments: number;
  /** Fulfillments with nothing to plan: the plugin had already issued their invoice, or they were cancelled
   * before an invoice was issued. */
  readonly skipped: { readonly alreadyInvoiced: number; readonly canceled: number };
  /** The buyers' VAT-IDs checked through the plugin's verifier, each distinct one once, and what came back. */
  readonly vatIdChecks: {
    readonly distinct: number;
    readonly confirmed: number;
    readonly notConfirmed: number;
    readonly unavailable: number;
  };
}

/** `warn`: the plugin runs, with a consequence the details name. `fail`: it does not start, or refuses every
 * document of a kind. `not-checked`: the run could not tell. */
export type PreflightStatus = "pass" | "warn" | "fail" | "not-checked";

interface PreflightResult {
  readonly status: PreflightStatus;
}

export type PreflightCheck =
  /** The platform release against the releases the plugin supports; `supported` describes them. */
  | (PreflightResult & {
      readonly check: "platform-version";
      readonly installed: string | null;
      readonly supported: string;
    })
  /** The plugin's database migrations not applied yet, by name. */
  | (PreflightResult & { readonly check: "migrations"; readonly pending: readonly string[] })
  /** The plugin options that are missing or invalid, by path (`seller.contact.email`) — never their values. */
  | (PreflightResult & { readonly check: "plugin-options"; readonly invalid: readonly string[] })
  /** The countries whose tax region charges no VAT. `fail` when the seller's is among them: every domestic order
   * is refused (`NO_VAT_CHARGED`). Another country without a rate is listed, not judged. */
  | (PreflightResult & {
      readonly check: "tax-rates";
      readonly sellerCountry: string;
      readonly withoutVat: readonly string[];
    })
  /** Other plugins known to issue invoices of their own. With both running, a sale gets two invoices. */
  | (PreflightResult & {
      readonly check: "other-invoice-plugins";
      readonly plugins: readonly string[];
    })
  /** Where the plugin stores the documents it issues: the file provider, `null` for none. */
  | (PreflightResult & { readonly check: "file-storage"; readonly provider: string | null })
  /** Whether a VAT-ID verifier is configured. Without one, an intra-EU supply to a business is refused
   * (`VAT_ID_UNVERIFIED`) unless its VAT-ID is confirmed by hand. */
  | (PreflightResult & { readonly check: "vat-id-verifier"; readonly configured: boolean });

export interface ValidatorTool {
  readonly name: string;
  readonly version: string;
  /** Of the file installed in the validator's image, as pinned in `docker/images.lock`. */
  readonly sha256: string;
}

export type ValidationRun =
  | { readonly status: "ran"; readonly tools: readonly ValidatorTool[] }
  /** Not validated — which is never the same as valid. */
  | {
      readonly status: "not-run";
      readonly reason: "docker-unavailable" | "images-missing" | "not-requested";
    };

/** What a document is for. Internal ids only. */
export type DocumentRef =
  | { readonly type: "invoice"; readonly orderId: string; readonly fulfillmentId: string }
  | {
      readonly type: "credit-note";
      readonly orderId: string;
      readonly trigger: "refund";
      readonly refundId: string;
    }
  | {
      readonly type: "credit-note";
      readonly orderId: string;
      readonly trigger: "fulfillment-canceled";
      readonly fulfillmentId: string;
    }
  | { readonly type: "credit-note"; readonly orderId: string; readonly trigger: "order-canceled" };

/** A refusal or a notice: the code the plugin records for it, what the code means, where it is explained. */
export interface Finding {
  readonly code: string;
  /** One sentence, the same for every document with this code — never the error's own message, which can
   * name amounts. */
  readonly reason: string;
  /** Its entry in the published error reference. */
  readonly docsUrl: string;
  /** A refusal because of the buyer's country: that country, ISO 3166-1 alpha-2. */
  readonly country?: string;
  /** A notice whose cause the plugin can tell: `shipping-split-across-rates`. */
  readonly cause?: string;
}

/** One validator's verdict on one document's XML. */
export interface ValidatorVerdict {
  readonly tool: "kosit" | "mustang";
  /** `valid`: no message at warning level or above. `warnings`: accepted, with warnings. `invalid`: rejected. */
  readonly result: "valid" | "warnings" | "invalid";
  /** The rules that fired at warning level or above — `BR-DE-15` — ids only: a validator's message text can
   * quote the document. */
  readonly rules: readonly string[];
}

export type DocumentValidation =
  | { readonly status: "not-run" }
  | { readonly status: "ran"; readonly verdicts: readonly ValidatorVerdict[] };

/** The run failed on a document: an exception nothing handled. */
export interface ToolError {
  /** What failed: planning the document, writing its XML, or validating it. */
  readonly stage: "plan" | "serialize" | "validate";
  /** The error's code; an error without one is `INTERNAL_ERROR`. */
  readonly code: string;
  /** Its class, `TypeError`. Its message is left out: it holds whatever its source put there. */
  readonly errorClass: string;
  /** Its stack, without the message: the frames in `@normwerk` packages, every run of other frames counted. */
  readonly stack: readonly StackFrame[];
  /** The first 12 hex digits of SHA-256 over `errorClass` and `stack`: one defect, one fingerprint, in any
   * shop. */
  readonly fingerprint: string;
}

export type StackFrame =
  /** A frame in a `@normwerk` package: its function, and where from the package's name on —
   * `@normwerk/einvoice-medusa/.medusa/server/src/invoices/issue-invoice.js:268:19`. No absolute path. */
  | { readonly function: string; readonly at: string }
  /** That many frames in a row outside the `@normwerk` packages — the platform's, Node.js's. */
  | { readonly outside: number };

/** A limit of the dry run itself for one document — not a finding about the shop. */
export type DocumentLimitationCode =
  /** This release's dry run plans invoices only: a refund or a cancellation is listed, not planned. */
  | "CREDIT_NOTES_NOT_ASSESSED"
  /** The order changed after this fulfillment — `changes` says how. The run reads the order as it is now, not
   * as it was when the invoice would have been issued, so it does not judge the invoice. */
  | "ORDER_CHANGED_AFTER_SHIPMENT";

/** How an order changed after a fulfillment: an order edit; a return received of an item the fulfillment
 * shipped; an exchange or a claim; a change of the order's own details (its metadata, email, address). */
export type OrderChangeKind = "edit" | "return" | "exchange" | "claim" | "order-update";

/** A limit of the dry run itself for the whole shop. */
export type RunLimitationCode =
  /** The shop renders its own PDF for the invoices. The run does not call it, so whether that PDF can become
   * PDF/A-3 is not assessed; the XML is. */
  "SHOP_PDF_NOT_ASSESSED";

export const OUTCOME_CLASSES = [
  "would-issue",
  "would-issue-with-notice",
  "would-refuse",
  "not-assessed",
  "tool-error",
] as const;

export type OutcomeClass = (typeof OUTCOME_CLASSES)[number];

export type Outcome =
  /** The plugin would issue the document. `profile` is the one it would choose: `EN16931`, `XRECHNUNG`. */
  | {
      readonly class: "would-issue";
      readonly profile: string;
      readonly validation: DocumentValidation;
    }
  /** The plugin would issue it, with a notice for the merchant — something to act on, such as a refund. */
  | {
      readonly class: "would-issue-with-notice";
      readonly profile: string;
      readonly notice: Finding;
      readonly validation: DocumentValidation;
    }
  /** The plugin would not issue it, and says why. */
  | { readonly class: "would-refuse"; readonly refusal: Finding }
  /** The dry run cannot tell what the plugin would do. */
  | {
      readonly class: "not-assessed";
      readonly limitation: DocumentLimitationCode;
      /** For `ORDER_CHANGED_AFTER_SHIPMENT`: how the order changed, each kind once. */
      readonly changes?: readonly OrderChangeKind[];
    }
  /** The run failed on the document. */
  | { readonly class: "tool-error"; readonly error: ToolError };

export interface Assessment {
  readonly document: DocumentRef;
  readonly outcome: Outcome;
}
