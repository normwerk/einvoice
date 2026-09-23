/**
 * T-070: `einvoice` module — holds the merchant-level configuration this
 * plugin needs (seller identity, default e-invoice profile), resolved from
 * `medusa-config.ts`'s `plugins: [{ resolve: "@normwerk/einvoice-medusa",
 * options: {...} }]` (verified real mechanism — Medusa's own plugin-starter
 * `src/modules/README.md`: "these options are passed to the modules within
 * the plugin").
 *
 * T-071 added this module's actual persistence: `EinvoiceDocument` (one row per generated invoice/credit
 * note — the real idempotency guard, see its own doc comment) and `EinvoiceCounter` (backs this plugin's
 * `NumberingStore` implementation, `numbering-store.ts`). Both are real, migrated Postgres tables — not
 * this class's own business logic (subscribers, T-071, own the mapping/orchestration; this class only
 * validates config and does the two pieces of real I/O a `NumberingStore`/idempotency guard need).
 *
 * Constructor signature — `(container, options)` — verified against a real
 * Medusa module provider's own compiled source
 * (`@medusajs/notification-local@2.19.0`'s `LocalNotificationService`,
 * `constructor({ logger }, options)`), not assumed from documentation. The `{ baseRepository }` destructure
 * (T-071) matches the same real pattern in `@medusajs/api-key`'s own `ApiKeyModuleService` constructor —
 * `MedusaService(...)`'s generated base class already sets `this.baseRepository_` from the full container
 * via `super(...arguments)`, but every real Medusa module service re-assigns it explicitly too, so this
 * class does the same rather than relying on an implementation detail of the generated base alone.
 */
// `@normwerk/einvoice-commerce` is an ESM package ("type": "module"); this plugin's own tsconfig is
// Medusa's own CommonJS-mode convention (module: "Node16", no "type": "module" here — verified against
// two real Medusa plugins, the official create-medusa-app --plugin scaffold and @webbers/invoices-medusa,
// neither sets it). A type-only import across that boundary needs an explicit resolution-mode (TS 5.3+),
// not a real cross-module runtime concern since these are erased at compile time anyway.
import type {
  CommerceParty,
  EInvoiceProfileName,
  VatIdVerifier,
} from "@normwerk/einvoice-commerce" with {
  "resolution-mode": "import",
};
import type { Invoice, PaymentMeansCode } from "@normwerk/einvoice-model" with {
  "resolution-mode": "import",
};
import { InjectTransactionManager, MedusaContext, MedusaService } from "@medusajs/framework/utils";
import type { Context } from "@medusajs/framework/types";
import EinvoiceCounter from "./models/einvoice-counter.js";
import EinvoiceDocument from "./models/einvoice-document.js";

export interface EinvoiceModuleOptions {
  /**
   * The merchant's own party details — every invoice this plugin builds uses them as the seller
   * (`CommerceInvoiceInput.seller`). Besides the name, country, city and post code, the plugin refuses to
   * start without the seller's VAT-ID (`vatIdentifier`, BT-31), street (`addressLine1` — the street and
   * house number, or a PO box), electronic address with its scheme (`electronicAddress`,
   * `electronicAddressScheme`) and contact (`contact`: name, telephone, email).
   */
  readonly seller: CommerceParty;
  /**
   * Passed straight through to `selectProfile`'s own `preferredProfile` (`@normwerk/einvoice-commerce`)
   * — the merchant's preference for an ordinary B2B invoice. Never overrides a B2G buyer (a Leitweg-ID
   * buyer reference forces XRECHNUNG regardless — `selectProfile`'s own rule, not re-implemented here).
   * Defaults to `selectProfile`'s own default ("EN16931") when omitted.
   */
  readonly defaultProfile?: EInvoiceProfileName;
  /**
   * T-070/T-071: BG-16, payment instructions — how the buyer pays the seller: a payment means code and,
   * for a bank transfer, an IBAN. Required: every document this plugin builds declares the XRechnung 3.0
   * CIUS, whose BR-DE-1 makes payment instructions mandatory whichever profile `selectProfile` resolves,
   * even though `CommerceInvoiceInput.payment` is optional in its own type. `terms` (BT-20) is not in the
   * data model yet; `buildInvoice` reports it as a warning rather than dropping it silently.
   */
  readonly payment: {
    readonly means: PaymentMeansCode;
    readonly iban?: string;
    readonly terms?: string;
  };
  /**
   * T-072: work on top of the `@webbers/invoices-medusa` PDF plugin instead of numbering documents
   * yourself. With `kind: "webbers"`, each invoice and credit note takes the number of the Webbers
   * document for the same order or refund (their `display_id`) instead of one from this plugin's own
   * counter, and this plugin's XML is embedded into their PDF as PDF/A-3 when they produce one
   * (`integrations/webbers.ts`). Omitted (the default), the plugin works standalone, with no PDF plugin
   * installed at all.
   */
  readonly integration?: {
    readonly kind: "webbers";
    /** How long a subscriber waits for their invoice to appear before giving up, ms — their workflow
     * offers no hook to wait on (`integrations/webbers.ts`). Defaults to `waitForWebbersInvoice`'s own
     * default (10s) when omitted. */
    readonly waitForInvoiceMs?: number;
    readonly pollIntervalMs?: number;
  };
  /**
   * T-073: in standalone mode (no `integration`), a PDF to embed the XML into. The plugin calls `basePdf`
   * once per document with the built `Invoice` — the same object it serializes to XML — so the PDF can
   * show exactly the number (BT-1) and amounts the XML carries; the result is embedded as PDF/A-3
   * (`embedInvoiceInPdfA3`). Use your own invoice template, another plugin, or `renderInvoicePdf` from
   * `@normwerk/einvoice-pdfa`. Returning `undefined` — or omitting the option — produces XML only.
   *
   * Ignored when `integration` is set. The PDF is embedded as it is: `embedInvoiceInPdfA3` does not repair
   * a PDF that isn't PDF/A-eligible, such as one whose fonts are not embedded (see `render-invoice.ts`).
   */
  readonly standalone?: {
    readonly basePdf?: (
      invoice: Invoice,
    ) => Promise<Uint8Array | undefined> | Uint8Array | undefined;
  };
  /**
   * T-079/P-12: checks a buyer's VAT-ID, typically against the EU's VIES service. `buildInvoice` refuses
   * category K (an intra-EU supply) without a positive check; the subscribers call `verify()` before
   * building the document (ADR-003: I/O happens before `buildInvoice`, never inside it) and pass the result
   * on as its evidence. The plugin ships no VIES client — implement `VatIdVerifier` from
   * `@normwerk/einvoice-commerce` (see `docs/quickstart-medusa.md`). Omitted, an order that would be
   * category K is refused, unless the merchant declares on the order that the VAT-ID was confirmed another
   * way (`order.metadata.regime_override`, kind `intra-eu-confirmed`).
   */
  readonly vatIdVerifier?: VatIdVerifier;
  /**
   * T-136/P-26: whether the merchant is registered for the EU's OSS (one-stop shop) scheme — a fact about
   * the seller that holds for every order (`docs/tax-semantics.md` row 7). For a distance sale to a
   * consumer in another EU country, `decideVatCategory` also needs the destination country's rate on the
   * order (`order.metadata.oss_rate_override`); this option covers only the registration and never
   * bypasses that check. Defaults to `false`.
   */
  readonly ossRegistered?: boolean;
  /**
   * T-078: the clock for a document's issue date and for `vatIdVerifier.verify()`'s `now` argument.
   * Defaults to `() => new Date()`. Meant for tests: the e2e stand fixes it so every document carries the
   * same date on every run.
   */
  readonly now?: () => Date;
}

export class InvalidEinvoiceModuleOptionsError extends Error {
  constructor(readonly reason: string) {
    super(`@normwerk/einvoice-medusa plugin options are invalid: ${reason}`);
    this.name = "InvalidEinvoiceModuleOptionsError";
  }
}

function assertValidOptions(options: EinvoiceModuleOptions): void {
  if (options.seller === undefined || options.seller === null) {
    throw new InvalidEinvoiceModuleOptionsError(
      "options.seller is required — every invoice this plugin builds needs a seller party " +
        "(name/countryCode/city/postCode/vatIdentifier, CommerceParty from @normwerk/einvoice-commerce).",
    );
  }
  if (!options.seller.name || options.seller.name.trim() === "") {
    throw new InvalidEinvoiceModuleOptionsError(
      "options.seller.name is required and cannot be empty.",
    );
  }
  if (options.seller.countryCode !== "DE") {
    // T-077: every VAT rule, rate and invoice requirement this plugin applies is German law, and
    // `decideVatCategory` refuses any other seller country — but only once an order arrives. Checked here so
    // an unsupported seller fails at boot, not on the first order.
    throw new InvalidEinvoiceModuleOptionsError(
      `options.seller.countryCode "${String(options.seller.countryCode)}" is not supported — this release ` +
        'invoices for a seller established in Germany only (countryCode "DE"): the VAT rules, rates and ' +
        "invoice requirements it applies are German law.",
    );
  }
  if (!options.seller.vatIdentifier || options.seller.vatIdentifier.trim() === "") {
    // Structurally optional on CommerceParty (a buyer doesn't always have one) but not for the
    // merchant themselves — TaxContext.sellerVatId (mandatory) always needs a real value from here.
    throw new InvalidEinvoiceModuleOptionsError(
      "options.seller.vatIdentifier is required for the plugin's own seller (TaxContext.sellerVatId " +
        "has no fallback) even though CommerceParty itself leaves vatIdentifier optional for a buyer.",
    );
  }
  if (!options.seller.electronicAddress || !options.seller.electronicAddressScheme) {
    // Found by a real KoSIT rejection (T-071's own e2e proof, not anticipated when T-070 first wrote this
    // validator): BR-62 ("The Seller electronic address (BT-34) shall have a Scheme identifier") is one of
    // the base "EN16931 (CII)" Schematron rules KoSIT's tooling enforces unconditionally — not an
    // XRechnung-specific rule, and not one `buildInvoice` itself guards (it just passes through whatever
    // `CommerceParty.electronicAddress`/`electronicAddressScheme` it's given, `build-invoice.ts` lines
    // 136-137). Every fixture already in this repo sets both (`electronicAddressScheme: "EM"` for a plain
    // email address, the same convention used here) — this plugin refuses to build an invoice that would
    // fail that same real validator rather than silently emitting one.
    throw new InvalidEinvoiceModuleOptionsError(
      "options.seller.electronicAddress and options.seller.electronicAddressScheme are both required — " +
        'e.g. { electronicAddress: "invoicing@example.com", electronicAddressScheme: "EM" } — BR-62 ' +
        "rejects an invoice missing either (confirmed against a real KoSIT Validator run).",
    );
  }
  if (!options.seller.addressLine1?.trim()) {
    // §14 Abs. 4 Satz 1 Nr. 1 UStG: the seller's full address on every invoice. `buildInvoice` refuses
    // without it, but only once an order arrives — checked here so the plugin fails at boot instead.
    throw new InvalidEinvoiceModuleOptionsError(
      "options.seller.addressLine1 is required — the street and house number (or a PO box) of the seller; " +
        "§14 Abs. 4 Satz 1 Nr. 1 UStG requires the seller's full address on every invoice.",
    );
  }
  const contact = options.seller.contact;
  if (!contact?.name?.trim() || !contact.telephone?.trim() || !contact.email?.trim()) {
    // BR-DE-2: every document this plugin builds declares the XRechnung 3.0 CIUS, which makes seller
    // contact (BG-6: name, telephone, email) mandatory. `buildInvoice` refuses without it — but only once an
    // order arrives, after a document number is taken. Checked here instead, so the plugin fails at boot,
    // as docs/quickstart-medusa.md promises.
    throw new InvalidEinvoiceModuleOptionsError(
      "options.seller.contact is required, with a non-empty name, telephone and email — the XRechnung CIUS " +
        "every document declares makes seller contact mandatory (BR-DE-2).",
    );
  }
  if (options.payment === undefined || options.payment === null || !options.payment.means) {
    // BR-DE-1 ("An Invoice must contain Payment instructions (BG-16)") — same class of finding as the
    // electronic-address check above, from the same real KoSIT run: `buildInvoice` never enforces this
    // itself (`options.payment` maps straight through, `build-invoice.ts` lines 341-343), so an adapter
    // that forgets it produces an XML document that type-checks, builds, and still fails the real
    // validator — exactly the class of silent failure `AGENTS.md` §7 warns against calling "passing".
    throw new InvalidEinvoiceModuleOptionsError(
      'options.payment.means is required — e.g. { means: "58", iban: "DE89..." } ("58" = SEPA credit ' +
        "transfer, the same convention every fixture already in this repo uses) — BR-DE-1 rejects an " +
        "invoice with no payment instructions at all (confirmed against a real KoSIT Validator run).",
    );
  }
}

export type EinvoiceDocumentType = "invoice" | "credit_note";

export interface EinvoiceDocumentRecord {
  readonly id: string;
  readonly type: EinvoiceDocumentType;
  readonly order_id: string;
  readonly idempotency_key: string;
  readonly document_number: string;
  /** File Module file id (T-074, `storage.ts`) — the XML content itself is no longer stored on this row,
   * `fetchFileBytes`/an admin or store download route reads it back from there. */
  readonly xml_file_id: string;
  /** File Module file id for the PDF/A-3 (T-072's Webbers integration, or T-073's standalone
   * `basePdf` hook) — `null` for a pure-XML document (standalone mode with no hook, or Webbers mode
   * before their PDF was ready). */
  readonly pdf_file_id: string | null;
}

export interface RecordDocumentInput {
  readonly type: EinvoiceDocumentType;
  readonly orderId: string;
  readonly idempotencyKey: string;
  readonly documentNumber: string;
  readonly xmlFileId: string;
  readonly pdfFileId?: string | null;
}

export interface RecordDocumentResult {
  readonly document: EinvoiceDocumentRecord;
  /** `false` means a document for this `(type, idempotencyKey)` already existed — the real idempotency
   * signal a subscriber (T-071) uses to skip re-emitting/re-notifying, not just skip re-inserting. */
  readonly created: boolean;
}

/** Minimal shape this class actually calls on the MikroORM transaction manager/knex it's handed —
 * kept local and structural rather than importing `knex`/`@mikro-orm/core` as a new dependency (neither
 * is declared by this package; `@medusajs/framework` already brings a real one into the module's own
 * container at runtime, this just describes the two methods used from it). */
interface MinimalKnex {
  raw<T = unknown>(
    sql: string,
    bindings?: readonly unknown[],
  ): Promise<{ readonly rows: readonly T[] }>;
}
interface MinimalTransactionManager {
  getTransactionContext?(): MinimalKnex | undefined;
  getKnex(): MinimalKnex;
}

interface InjectedDependencies {
  readonly baseRepository: { transaction: (...args: unknown[]) => Promise<unknown> };
}

/**
 * Resolved from the container as `EINVOICE_MODULE` (`"einvoice"`). Holds the merchant config (T-070) and
 * the two pieces of real persistence T-071 needs: `allocateNextNumber` (a race-safe counter,
 * `numbering-store.ts` wraps this as a `NumberingStore`) and `recordDocumentIfAbsent` (the idempotency
 * guard). No business logic beyond that (ADR-001/AGENTS.md §6 apply to this adapter too, not just
 * `einvoice-commerce` itself): subscribers (T-071) do the actual order→`CommerceInvoiceInput` mapping and
 * call into `@normwerk/einvoice-commerce`/`@normwerk/einvoice-cii` themselves.
 */
export default class EinvoiceModuleService extends MedusaService({
  EinvoiceDocument,
  EinvoiceCounter,
}) {
  readonly options: EinvoiceModuleOptions;

  constructor(_container: InjectedDependencies, options: EinvoiceModuleOptions) {
    // `_container` (unused directly, `noUnusedParameters`' own underscore-prefix exemption) is still a real,
    // required part of this signature, not dead code to remove — `super(...arguments)` is the documented
    // pattern every MedusaService-based module service uses (e.g. @medusajs/api-key's own
    // ApiKeyModuleService); the generated base class reads more off the full container than this
    // constructor's own declared parameter type describes, which is exactly why `arguments` is used here
    // instead of a named reference to this parameter.
    // eslint-disable-next-line prefer-rest-params
    super(...arguments);
    assertValidOptions(options);
    this.options = options;
  }

  /**
   * Atomically returns the next number for `series` (e.g. `"invoice-2026"`) — the method
   * `numbering-store.ts`'s `NumberingStore` implementation delegates to. A single
   * `INSERT ... ON CONFLICT ... RETURNING` is what makes this race-safe: Postgres resolves the conflict
   * and the increment as one atomic operation, so two concurrent calls for the same series can never both
   * observe the same "current" value the way a naive `SELECT` then `UPDATE` from application code would
   * (`einvoice-counter.ts`'s own doc comment).
   */
  @InjectTransactionManager()
  async allocateNextNumber(
    series: string,
    @MedusaContext() sharedContext: Context = {},
  ): Promise<number> {
    const manager = sharedContext.transactionManager as MinimalTransactionManager;
    const knex = manager.getTransactionContext?.() ?? manager.getKnex();
    const result = await knex.raw<{ value: number | string }>(
      `insert into "einvoice_counter" ("series", "value") values (?, 1)
       on conflict ("series") do update set "value" = "einvoice_counter"."value" + 1
       returning "value"`,
      [series],
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new Error(`allocateNextNumber("${series}"): INSERT ... RETURNING produced no row.`);
    }
    return Number(row.value);
  }

  /**
   * Inserts an `EinvoiceDocument` for `(type, idempotencyKey)` unless one already exists — the actual
   * idempotency guard (`einvoice-document.ts`'s own doc comment). Relies on the table's real Postgres
   * `UNIQUE` index rather than a "does one exist" check beforehand: two concurrent calls for the same key
   * can both reach the insert, but only one can win it.
   *
   * The loser is recognised by re-reading the key, not by the error's shape (P-49): Medusa's own repository
   * layer (`@medusajs/utils` `dbErrorMapper`) turns MikroORM's `UniqueConstraintViolationException` into a
   * `MedusaError` of type `invalid_data` whose `name` is plain `"Error"`, so an earlier check on
   * `error.name` never matched a real race. Whatever the insert threw: if a document for this key exists
   * now, someone else recorded it; if none does, the insert failed for another reason and that error is
   * rethrown unchanged.
   */
  async recordDocumentIfAbsent(input: RecordDocumentInput): Promise<RecordDocumentResult> {
    try {
      const created = (await this.createEinvoiceDocuments({
        type: input.type,
        order_id: input.orderId,
        idempotency_key: input.idempotencyKey,
        document_number: input.documentNumber,
        xml_file_id: input.xmlFileId,
        pdf_file_id: input.pdfFileId ?? null,
      })) as EinvoiceDocumentRecord;
      return { document: created, created: true };
    } catch (error) {
      const existing = await this.listEinvoiceDocuments({
        type: input.type,
        idempotency_key: input.idempotencyKey,
      });
      const document = existing[0] as EinvoiceDocumentRecord | undefined;
      if (document === undefined) {
        // No document for this key: not a lost race, a real failure of this insert.
        throw error;
      }
      return { document, created: false };
    }
  }
}
