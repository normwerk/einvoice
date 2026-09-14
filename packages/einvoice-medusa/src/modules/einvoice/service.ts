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
import type { CommerceParty, EInvoiceProfileName } from "@normwerk/einvoice-commerce" with {
  "resolution-mode": "import",
};
import type { PaymentMeansCode } from "@normwerk/einvoice-model" with {
  "resolution-mode": "import",
};
import { InjectTransactionManager, MedusaContext, MedusaService } from "@medusajs/framework/utils";
import type { Context } from "@medusajs/framework/types";
import EinvoiceCounter from "./models/einvoice-counter.js";
import EinvoiceDocument from "./models/einvoice-document.js";

export interface EinvoiceModuleOptions {
  /**
   * The merchant's own party details — every invoice this plugin builds uses this as `seller`
   * (`CommerceInvoiceInput.seller`). Includes `vatIdentifier` (BT-31); there is no separate
   * top-level "VAT-ID" field even though the task description names it alongside "seller" —
   * `CommerceParty` already carries it, and a second field would just be a second place for the
   * same fact to go stale.
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
   * BG-16 (payment instructions) — how the buyer should pay the seller (bank transfer details), the same
   * way `seller` itself is merchant-level config rather than something read off an order. Found mandatory
   * for every invoice this plugin builds by a real KoSIT rejection (BR-DE-1, T-071's own e2e proof) — not
   * anticipated when T-070 first scoped this module's options, since `buildInvoice`'s own
   * `specificationIdentifier` always targets the XRechnung 3.0 CIUS regardless of which profile
   * `selectProfile` resolves, so BG-16 is never actually optional the way it looks from
   * `CommerceInvoiceInput.payment`'s own type (`?:`) alone.
   */
  readonly payment: {
    readonly means: PaymentMeansCode;
    readonly iban?: string;
    readonly terms?: string;
  };

  // Storage config (T-074, "хранилище" in the task description) is deliberately not modeled here yet
  // — T-074 is the task that actually implements File Module storage and decides what, if anything,
  // needs to be merchant-configurable about it. Adding an undesigned field now would just be a guess.
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
        "rejects an invoice missing either (confirmed against a real KoSIT Validator run, T-071).",
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
        "invoice with no payment instructions at all (confirmed against a real KoSIT Validator run, T-071).",
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
  readonly xml: string;
}

export interface RecordDocumentInput {
  readonly type: EinvoiceDocumentType;
  readonly orderId: string;
  readonly idempotencyKey: string;
  readonly documentNumber: string;
  readonly xml: string;
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

  constructor(container: InjectedDependencies, options: EinvoiceModuleOptions) {
    // `super(...arguments)` is the real, documented pattern every MedusaService-based module service uses
    // (e.g. @medusajs/api-key's own ApiKeyModuleService) — the generated base class reads more off the
    // full container than this constructor's own declared parameter type describes.
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
   * can both reach the insert, but only one can win it, and the loser's own `UniqueConstraintViolationException`
   * (real MikroORM exception, `@mikro-orm/core/exceptions.js` — `this.name = this.constructor.name` on its
   * `DriverException` base, so duck-typing `.name` here is checking the real, stable contract, not
   * guessing at one) is exactly the "someone else already recorded this" signal — no separate dependency
   * on `@mikro-orm/core` needed to detect it.
   */
  async recordDocumentIfAbsent(input: RecordDocumentInput): Promise<RecordDocumentResult> {
    try {
      const created = (await this.createEinvoiceDocuments({
        type: input.type,
        order_id: input.orderId,
        idempotency_key: input.idempotencyKey,
        document_number: input.documentNumber,
        xml: input.xml,
      })) as EinvoiceDocumentRecord;
      return { document: created, created: true };
    } catch (error) {
      if (!(error instanceof Error) || error.name !== "UniqueConstraintViolationException") {
        throw error;
      }
      const existing = await this.listEinvoiceDocuments({
        type: input.type,
        idempotency_key: input.idempotencyKey,
      });
      const document = existing[0] as EinvoiceDocumentRecord | undefined;
      if (document === undefined) {
        // The conflict really did come from this (type, idempotency_key) pair — this branch would only
        // reach here if the row won the race and was deleted again before this re-read, which nothing in
        // this plugin ever does. Re-throwing is more honest than fabricating a document.
        throw error;
      }
      return { document, created: false };
    }
  }
}
