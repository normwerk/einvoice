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
import { assertSupportedMedusaVersion, installedMedusaVersion } from "../../medusa-version.js";
import EinvoiceDocument from "./models/einvoice-document.js";
import EinvoiceRefusal from "./models/einvoice-refusal.js";
import { otherInvoicePlugins, type InvoicePluginConfig } from "./other-invoice-plugins.js";
import {
  errorDocsUrl,
  PluginError,
  supportRequestUrl,
  type PluginErrorCode,
} from "../../errors.js";
import type { InvoiceNotice } from "../../mapping/charged-reconciliation.js";

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
   * T-073: a PDF to embed the XML into. The plugin calls `basePdf`
   * once per document with the built `Invoice` — the same object it serializes to XML — so the PDF can
   * show exactly the number (BT-1) and amounts the XML carries; the result is embedded as PDF/A-3
   * (`embedInvoiceInPdfA3`). Use your own invoice template, another plugin, or `renderInvoicePdf` from
   * `@normwerk/einvoice-pdfa`. Returning `undefined` — or omitting the option — produces XML only.
   *
   * The PDF is embedded as it is: `embedInvoiceInPdfA3` does not repair
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

/** T-077: the seller countries this release supports — `SUPPORTED_SELLER_COUNTRIES` of
 * `@normwerk/einvoice-commerce`, restated because the options are checked synchronously when the module loads,
 * before an ESM package can be imported. `service.test.ts` checks the two agree. */
export const SUPPORTED_SELLER_COUNTRIES: readonly string[] = ["DE"];

export class InvalidEinvoiceModuleOptionsError extends PluginError {
  constructor(
    readonly reason: string,
    code: PluginErrorCode = "INVALID_PLUGIN_OPTIONS",
  ) {
    super(code, `@normwerk/einvoice-medusa plugin options are invalid: ${reason}`);
    this.name = "InvalidEinvoiceModuleOptionsError";
  }
}

function assertValidOptions(options: EinvoiceModuleOptions): void {
  if ("integration" in options) {
    // P-68 (M-040): the mode that embedded this XML into @webbers/invoices-medusa's PDF is gone — their PDF
    // shows Medusa's totals, which differ from the e-invoice wherever this plugin corrects the VAT, and two
    // documents for one supply are two invoices. Refused rather than ignored, so a configuration written
    // for it does not start as if it still worked.
    throw new InvalidEinvoiceModuleOptionsError(
      "options.integration is not supported — the plugin issues its own invoices and does not embed its XML " +
        "into another invoice plugin's PDF: that PDF shows Medusa's totals, which differ from the e-invoice " +
        "wherever the plugin corrects the VAT, and two documents for one supply are two invoices. Remove the " +
        "option; to add a PDF of your own, use options.standalone.basePdf.",
      "UNSUPPORTED_PLUGIN_OPTION",
    );
  }
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
  if (!SUPPORTED_SELLER_COUNTRIES.includes(options.seller.countryCode)) {
    // T-077: every VAT rule, rate and invoice requirement this plugin applies is German law, and
    // `decideVatCategory` refuses any other seller country — but only once an order arrives. Checked here so
    // an unsupported seller fails at boot, not on the first order.
    const country = String(options.seller.countryCode);
    throw new InvalidEinvoiceModuleOptionsError(
      `seller country "${country}" is not supported by this release of @normwerk/einvoice-medusa ` +
        `(supported: ${SUPPORTED_SELLER_COUNTRIES.join(", ")}) — the VAT rules, rates and invoice ` +
        `requirements it applies are German law. See ${errorDocsUrl("UNSUPPORTED_SELLER_COUNTRY")}. ` +
        `Want ${country} sooner? ${supportRequestUrl("seller", country)}`,
      "UNSUPPORTED_SELLER_COUNTRY",
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
  /** File Module file id for the PDF/A-3 (T-073's `basePdf` hook) — `null` for a pure-XML document. */
  readonly pdf_file_id: string | null;
  /** P-63: issued although it states less VAT than Medusa charged — `null` otherwise. */
  readonly notice: InvoiceNotice | null;
  /** P-65: on a partial credit note, the received returns it paid for, per rate — `null` otherwise. */
  readonly covered_returns: readonly CoveredReturn[] | null;
  /** P-65: on an invoice, what each order line was invoiced at — `null` otherwise. */
  readonly line_values: readonly InvoicedLine[] | null;
  /** P-67: on an invoice, whether it carries the order's shipping. */
  readonly includes_shipping: boolean;
  /** P-67: on a credit note, the invoice it corrects — `null` otherwise. */
  readonly corrected_document_id: string | null;
}

/**
 * P-65: one order line as the invoice stated it — which Medusa line item, at what rate, for how many units,
 * for how much including VAT. A returned unit is credited at this value, whatever Medusa computes for the
 * line after the return (its lifecycle totals differ by release).
 */
export interface InvoicedLine {
  readonly itemId: string;
  readonly rate: string;
  readonly quantity: string;
  readonly gross: string;
  /** P-67: the line discount for these units, in the line's price basis. */
  readonly allowance?: string;
}

/** P-65: the part of a received return a credit note paid for, at one rate. */
export interface CoveredReturn {
  readonly returnId: string;
  readonly rate: string;
  readonly gross: string;
}

export interface RecordDocumentInput {
  readonly type: EinvoiceDocumentType;
  readonly orderId: string;
  readonly idempotencyKey: string;
  readonly documentNumber: string;
  readonly xmlFileId: string;
  readonly pdfFileId?: string | null;
  readonly notice?: InvoiceNotice | null;
  readonly coveredReturns?: readonly CoveredReturn[] | null;
  readonly lineValues?: readonly InvoicedLine[] | null;
  readonly includesShipping?: boolean;
  readonly correctedDocumentId?: string | null;
}

/** P-63: a document the plugin did not issue (`einvoice-refusal.ts`). */
export interface EinvoiceRefusalRecord {
  readonly id: string;
  readonly type: EinvoiceDocumentType;
  readonly order_id: string;
  readonly idempotency_key: string;
  readonly code: string;
  readonly details: Record<string, unknown>;
  readonly updated_at: Date | string;
}

export interface RecordRefusalInput {
  readonly type: EinvoiceDocumentType;
  readonly orderId: string;
  readonly idempotencyKey: string;
  readonly code: string;
  readonly details: Record<string, unknown>;
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
  /** Medusa's loaded configuration and logger — every module's container carries both
   * (`@medusajs/modules-sdk` `loadInternalModule`). */
  readonly configModule?: InvoicePluginConfig;
  readonly logger?: { warn(message: string): void };
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
  EinvoiceRefusal,
}) {
  readonly options: EinvoiceModuleOptions;

  constructor(container: InjectedDependencies, options: EinvoiceModuleOptions) {
    // `super(...arguments)` is the documented pattern every MedusaService-based module service uses (e.g.
    // @medusajs/api-key's own ApiKeyModuleService); the generated base class reads more off the full
    // container than this constructor's own declared parameter type describes, which is exactly why
    // `arguments` is used here instead of a named reference to this parameter.
    // eslint-disable-next-line prefer-rest-params
    super(...arguments);
    assertValidOptions(options);
    assertSupportedMedusaVersion(installedMedusaVersion());
    this.options = options;
    for (const plugin of otherInvoicePlugins(container.configModule)) {
      container.logger?.warn(
        `einvoice: ${plugin} is also installed. Two plugins that issue invoices give the buyer two invoices ` +
          "for one supply, and VAT is owed on each (§14c UStG) — turn off invoice creation in the other plugin.",
      );
    }
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
        notice: (input.notice ?? null) as Record<string, unknown> | null,
        covered_returns: (input.coveredReturns ?? null) as unknown as Record<
          string,
          unknown
        > | null,
        line_values: (input.lineValues ?? null) as unknown as Record<string, unknown> | null,
        includes_shipping: input.includesShipping ?? false,
        corrected_document_id: input.correctedDocumentId ?? null,
      })) as unknown as EinvoiceDocumentRecord;
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

  /**
   * P-63: records why a document was not issued — or updates the reason, when a retry is refused again. One
   * row per `(type, idempotencyKey)`; a concurrent insert that loses the unique index updates the winner's
   * row instead.
   */
  async recordRefusal(input: RecordRefusalInput): Promise<EinvoiceRefusalRecord> {
    const find = async (): Promise<EinvoiceRefusalRecord | undefined> =>
      (
        (await this.listEinvoiceRefusals({
          type: input.type,
          idempotency_key: input.idempotencyKey,
        })) as unknown as EinvoiceRefusalRecord[]
      )[0];
    const update = async (existing: EinvoiceRefusalRecord): Promise<EinvoiceRefusalRecord> =>
      (await this.updateEinvoiceRefusals({
        id: existing.id,
        code: input.code,
        details: input.details,
      })) as unknown as EinvoiceRefusalRecord;

    const existing = await find();
    if (existing !== undefined) {
      return update(existing);
    }
    try {
      return (await this.createEinvoiceRefusals({
        type: input.type,
        order_id: input.orderId,
        idempotency_key: input.idempotencyKey,
        code: input.code,
        details: input.details,
      })) as unknown as EinvoiceRefusalRecord;
    } catch (error) {
      const winner = await find();
      if (winner === undefined) {
        throw error;
      }
      return update(winner);
    }
  }

  /** P-66: an order cancelled before its invoice was issued needs none — its invoice refusals go. */
  async clearRefusalsOfOrder(type: EinvoiceDocumentType, orderId: string): Promise<void> {
    const refusals = (await this.listEinvoiceRefusals({
      type,
      order_id: orderId,
    })) as unknown as EinvoiceRefusalRecord[];
    if (refusals.length > 0) {
      await this.deleteEinvoiceRefusals(refusals.map((refusal) => refusal.id));
    }
  }

  /** P-63: the document was issued — its refusal, if one was recorded, no longer applies. */
  async clearRefusal(type: EinvoiceDocumentType, idempotencyKey: string): Promise<void> {
    const refusals = (await this.listEinvoiceRefusals({
      type,
      idempotency_key: idempotencyKey,
    })) as unknown as EinvoiceRefusalRecord[];
    if (refusals.length > 0) {
      await this.deleteEinvoiceRefusals(refusals.map((refusal) => refusal.id));
    }
  }
}
