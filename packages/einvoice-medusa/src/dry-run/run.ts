/**
 * T-214 (D-61): the dry run — what the plugin would have done with a shop's orders, without doing any of it.
 * Each fulfillment goes through `planInvoiceForFulfillment`, the plugin's own decision, with the run's caching
 * VAT-ID verifier and its register of the invoices planned so far (P-81); an order's fulfillments in the order
 * they were created. A ready plan is built and written as XML with a placeholder for the number. Nothing is
 * numbered, stored, recorded or announced, and the shop's own PDF is not asked for: the run calls none of the
 * commit's steps (`issueInvoiceForFulfillment`).
 *
 * Credit notes are not planned in this release: each refund and cancellation is listed as not assessed. So is
 * an invoice whose order changed after the fulfillment — edited, exchanged, claimed, its details changed, or an
 * item of the fulfillment returned (end-to-end, each made the run disagree with what the plugin had issued: a
 * returned line has no units left to check the invoice against, an exchange adds its shipping, a withdrawn
 * VAT-ID confirmation refuses what was issued). The run reads the order as it is now. Such a fulfillment is
 * still planned, and registered when its invoice could be built, so the order's next invoices take what it took.
 */
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import type { MedusaContainer } from "@medusajs/framework";
import type {
  Assessment,
  DocumentRef,
  DryRunReport,
  DryRunScope,
  OrderChangeKind,
  Outcome,
  PreflightCheck,
  RunLimitationCode,
} from "@normwerk/einvoice-conformance" with { "resolution-mode": "import" };
import { EINVOICE_MODULE } from "../modules/einvoice/index.js";
import type EinvoiceModuleService from "../modules/einvoice/service.js";
import {
  buildPlannedInvoice,
  ciiProfileOf,
  issuedInvoices,
  planInvoiceForFulfillment,
  plannedLineValues,
  type IssuancePlanOverrides,
} from "../invoices/issue-invoice.js";
import {
  issueDateInSellerTimeZone,
  UNALLOCATED_DOCUMENT_NUMBER,
} from "../mapping/order-to-commerce-invoice-input.js";
import { blockFinding, noticeFinding, refusalFinding } from "./findings.js";
import { DryRunRegister } from "./register.js";
import { toolErrorOf } from "./tool-error.js";
import { CachingVatIdVerifier } from "./vat-id-cache.js";
import type { DryRunVersions } from "./versions.js";

export type DryRunOrderSelection =
  /** The fulfillments created from `from` to `to`, both days included, where the seller is. */
  | { readonly kind: "period"; readonly from: string; readonly to: string }
  | { readonly kind: "orders"; readonly ids: readonly string[] };

type Instant = string | Date | null | undefined;

interface RunFulfillment {
  readonly id: string;
  readonly created_at?: Instant;
  readonly canceled_at?: Instant;
}

interface RunOrder {
  readonly id: string;
  readonly created_at?: Instant;
  readonly canceled_at?: Instant;
  readonly fulfillments?: readonly RunFulfillment[] | null;
  readonly payment_collections?:
    | readonly {
        readonly payments?:
          | readonly {
              readonly refunds?:
                readonly { readonly id: string; readonly created_at?: Instant }[] | null;
            }[]
          | null;
      }[]
    | null;
}

const RUN_ORDER_FIELDS = [
  "id",
  "created_at",
  "canceled_at",
  "fulfillments.id",
  "fulfillments.created_at",
  "fulfillments.canceled_at",
  "payment_collections.payments.refunds.id",
  "payment_collections.payments.refunds.created_at",
];
const PAGE_SIZE = 100;

export interface PlannedOrders {
  readonly assessments: readonly Assessment[];
  readonly scope: Omit<DryRunScope, "selection">;
  /** The XML of each invoice the plugin would issue, by fulfillment id. It names the buyer: it stays on the
   * machine the run ran on and never goes into the report. */
  readonly xml: ReadonlyMap<string, string>;
}

function time(instant: Instant): number {
  return instant === null || instant === undefined ? 0 : new Date(instant).getTime();
}

function byCreation<T extends { readonly created_at?: Instant }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => time(a.created_at) - time(b.created_at));
}

async function* ordersOf(
  container: MedusaContainer,
  selection: DryRunOrderSelection,
): AsyncGenerator<RunOrder> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  if (selection.kind === "orders") {
    const { data } = await query.graph({
      entity: "order",
      filters: { id: [...selection.ids] },
      fields: RUN_ORDER_FIELDS,
    });
    yield* byCreation(data as unknown as RunOrder[]);
    return;
  }
  for (let skip = 0; ; skip += PAGE_SIZE) {
    const { data } = await query.graph({
      entity: "order",
      fields: RUN_ORDER_FIELDS,
      pagination: { skip, take: PAGE_SIZE, order: { created_at: "ASC" } },
    });
    yield* data as unknown as RunOrder[];
    if (data.length < PAGE_SIZE) return;
  }
}

interface RunOrderChange {
  readonly change_type?: string | null;
  readonly status?: string | null;
  readonly created_at?: Instant;
  readonly confirmed_at?: Instant;
  readonly actions?:
    | readonly {
        readonly action?: string | null;
        readonly reference_id?: string | null;
        readonly details?: { readonly reference_id?: unknown } | null;
      }[]
    | null;
}

/** Medusa's change types that change the whole order — every fulfillment before them. */
const ORDER_CHANGES: Readonly<Record<string, OrderChangeKind>> = {
  edit: "edit",
  exchange: "exchange",
  claim: "claim",
  update_order: "order-update",
};
const RECEIVED = new Set(["RECEIVE_RETURN_ITEM", "RECEIVE_DAMAGED_RETURN_ITEM"]);

/** How the order changed after each of its fulfillments, by fulfillment id: an edit, exchange, claim or change
 * of its details after it, or a return received of an item it shipped. */
async function changesAfter(
  container: MedusaContainer,
  orderId: string,
  fulfillments: readonly RunFulfillment[],
): Promise<ReadonlyMap<string, readonly OrderChangeKind[]>> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const { data } = await query.graph({
    entity: "order_change",
    filters: { order_id: orderId },
    fields: [
      "change_type",
      "status",
      "created_at",
      "confirmed_at",
      "actions.action",
      "actions.reference_id",
      "actions.details",
    ],
  });
  const changes = (data as unknown as RunOrderChange[]).filter(
    ({ status }) => status !== "canceled" && status !== "declined",
  );
  const itemsOf = (fulfillmentId: string): ReadonlySet<string> =>
    new Set(
      changes.flatMap(({ actions }) =>
        (actions ?? [])
          .filter(
            ({ action, reference_id }) =>
              action === "FULFILL_ITEM" && reference_id === fulfillmentId,
          )
          .map(({ details }) => String(details?.reference_id)),
      ),
    );
  return new Map(
    fulfillments.map((fulfillment) => {
      const shipped = itemsOf(fulfillment.id);
      const kinds = changes.flatMap((change): OrderChangeKind[] => {
        if (time(change.confirmed_at ?? change.created_at) <= time(fulfillment.created_at))
          return [];
        const whole = ORDER_CHANGES[change.change_type ?? ""];
        if (whole !== undefined) return [whole];
        const returned = (change.actions ?? []).some(
          ({ action, details }) =>
            RECEIVED.has(action ?? "") && shipped.has(String(details?.reference_id)),
        );
        return returned ? ["return"] : [];
      });
      return [fulfillment.id, [...new Set(kinds)]];
    }),
  );
}

export async function planOrders(
  container: MedusaContainer,
  selection: DryRunOrderSelection,
  { issuedDocuments }: { readonly issuedDocuments: boolean },
): Promise<PlannedOrders> {
  const einvoiceService = container.resolve<EinvoiceModuleService>(EINVOICE_MODULE);
  const cii = await import("@normwerk/einvoice-cii");
  const seller = einvoiceService.options.seller.countryCode;
  const dayOf = (instant: Instant): string =>
    issueDateInSellerTimeZone(seller, new Date(time(instant)));
  const inPeriod = (fulfillment: RunFulfillment): boolean =>
    selection.kind === "orders" ||
    (dayOf(fulfillment.created_at) >= selection.from &&
      dayOf(fulfillment.created_at) <= selection.to);

  const register = new DryRunRegister(issuedDocuments ? issuedInvoices(einvoiceService) : null);
  const configured = einvoiceService.options.vatIdVerifier;
  const verifier = configured === undefined ? undefined : new CachingVatIdVerifier(configured);
  const overrides: IssuancePlanOverrides = {
    invoices: register,
    ...(verifier === undefined ? {} : { vatIdVerifier: verifier }),
  };

  const assessments: Assessment[] = [];
  const xml = new Map<string, string>();
  let orders = 0;
  let fulfillments = 0;
  const skipped = { alreadyInvoiced: 0, canceled: 0 };

  /** What the plugin would do with the fulfillment's invoice, or why there is nothing to do. */
  const planFulfillment = async (
    order: RunOrder,
    fulfillment: RunFulfillment,
    changes: readonly OrderChangeKind[],
  ): Promise<Outcome | "already-invoiced" | "canceled"> => {
    const changed: Outcome | undefined =
      changes.length === 0
        ? undefined
        : { class: "not-assessed", limitation: "ORDER_CHANGED_AFTER_SHIPMENT", changes };
    const plan = await planInvoiceForFulfillment(
      container,
      { orderId: order.id, fulfillmentId: fulfillment.id },
      overrides,
    );
    switch (plan.kind) {
      case "exists":
        return "already-invoiced";
      case "fulfillment-canceled":
        return "canceled";
      case "order-missing":
        throw new Error("The order was deleted while the dry run read it.");
      case "refused": {
        const finding = refusalFinding(plan.error);
        if (finding.code === "INTERNAL_ERROR")
          return { class: "tool-error", error: toolErrorOf(plan.error, "plan") };
        return changed ?? { class: "would-refuse", refusal: finding };
      }
      case "blocked":
        if (changed === undefined)
          return { class: "would-refuse", refusal: blockFinding(plan.block) };
        // Checked against what Medusa holds now — after a return, an exchange — the block says nothing about the
        // invoice the plugin issued then; that one still took its units and the shipping.
        try {
          const built = await buildPlannedInvoice(plan, UNALLOCATED_DOCUMENT_NUMBER);
          register.add(order.id, {
            idempotency_key: fulfillment.id,
            line_values: plannedLineValues(plan, built),
            includes_shipping: plan.shipment.includesShipping,
          });
        } catch (error) {
          return { class: "tool-error", error: toolErrorOf(error, "serialize") };
        }
        return changed;
      case "ready": {
        let document: string;
        try {
          const built = await buildPlannedInvoice(plan, UNALLOCATED_DOCUMENT_NUMBER);
          document = cii.serializeCii(built.invoice, { profile: ciiProfileOf(plan.profile) }).xml;
          register.add(order.id, {
            idempotency_key: fulfillment.id,
            line_values: plannedLineValues(plan, built),
            includes_shipping: plan.shipment.includesShipping,
          });
        } catch (error) {
          return { class: "tool-error", error: toolErrorOf(error, "serialize") };
        }
        if (changed !== undefined) return changed;
        xml.set(fulfillment.id, document);
        return plan.notice === null
          ? { class: "would-issue", profile: plan.profile, validation: { status: "not-run" } }
          : {
              class: "would-issue-with-notice",
              profile: plan.profile,
              notice: noticeFinding(plan.notice),
              validation: { status: "not-run" },
            };
      }
    }
  };

  for await (const order of ordersOf(container, selection)) {
    const ordered = byCreation(order.fulfillments ?? []);
    if (!ordered.some(inPeriod)) continue;
    orders += 1;
    const changes = await changesAfter(container, order.id, ordered);
    const assess = (document: DocumentRef, outcome: Outcome): void => {
      assessments.push({ document, outcome });
    };

    for (const fulfillment of ordered) {
      // A fulfillment after the period cannot change one in it; one before it is planned, unreported, for the
      // register: the order's later invoices read what it took.
      if (selection.kind === "period" && dayOf(fulfillment.created_at) > selection.to) break;
      const reported = inPeriod(fulfillment);
      if (reported) fulfillments += 1;
      const document: DocumentRef = {
        type: "invoice",
        orderId: order.id,
        fulfillmentId: fulfillment.id,
      };
      const canceled = time(fulfillment.canceled_at) > 0;
      if (canceled) {
        // A cancelled fulfillment has nothing to invoice; one the plugin had invoiced is credited.
        if (await register.hasInvoice(fulfillment.id)) {
          if (!reported) continue;
          skipped.alreadyInvoiced += 1;
          assess(
            {
              type: "credit-note",
              orderId: order.id,
              trigger: "fulfillment-canceled",
              fulfillmentId: fulfillment.id,
            },
            { class: "not-assessed", limitation: "CREDIT_NOTES_NOT_ASSESSED" },
          );
        } else if (reported) {
          skipped.canceled += 1;
        }
        continue;
      }
      let outcome: Awaited<ReturnType<typeof planFulfillment>>;
      try {
        outcome = await planFulfillment(order, fulfillment, changes.get(fulfillment.id) ?? []);
      } catch (error) {
        outcome = { class: "tool-error", error: toolErrorOf(error, "plan") };
      }
      if (!reported) continue;
      if (outcome === "already-invoiced") skipped.alreadyInvoiced += 1;
      else if (outcome === "canceled") skipped.canceled += 1;
      else assess(document, outcome);
    }

    const refunds = byCreation(
      (order.payment_collections ?? []).flatMap((collection) =>
        (collection.payments ?? []).flatMap((payment) => payment.refunds ?? []),
      ),
    );
    for (const refund of refunds) {
      assess(
        { type: "credit-note", orderId: order.id, trigger: "refund", refundId: refund.id },
        { class: "not-assessed", limitation: "CREDIT_NOTES_NOT_ASSESSED" },
      );
    }
    if (time(order.canceled_at) > 0 && (await register.invoicesOfOrder(order.id)).length > 0) {
      assess(
        { type: "credit-note", orderId: order.id, trigger: "order-canceled" },
        { class: "not-assessed", limitation: "CREDIT_NOTES_NOT_ASSESSED" },
      );
    }
  }

  return {
    assessments,
    scope: {
      orders,
      fulfillments,
      skipped,
      vatIdChecks: verifier?.counts() ?? {
        distinct: 0,
        confirmed: 0,
        notConfirmed: 0,
        unavailable: 0,
      },
    },
    xml,
  };
}

export interface DryRunReportParts {
  readonly startedAt: Date;
  readonly versions: DryRunVersions;
  readonly selection: DryRunOrderSelection;
  readonly preflight: readonly PreflightCheck[];
  readonly planned: PlannedOrders;
  /** Whether the shop renders its own PDF for the invoices (`standalone.basePdf`). */
  readonly shopPdf: boolean;
}

/** The report as the plugin writes it: not validated — `@normwerk/einvoice-conformance` validates it. */
export function dryRunReport({
  startedAt,
  versions,
  selection,
  preflight,
  planned,
  shopPdf,
}: DryRunReportParts): DryRunReport {
  const runLimitations: RunLimitationCode[] = shopPdf ? ["SHOP_PDF_NOT_ASSESSED"] : [];
  return {
    schemaVersion: 1,
    header: {
      startedAt: startedAt.toISOString().replace(/\.\d{3}Z$/, "Z"),
      plugin: versions.plugin,
      platform: versions.platform,
      nodeVersion: versions.nodeVersion,
      core: versions.core,
      rulesSha256: versions.rulesSha256,
      scope: {
        selection:
          selection.kind === "period"
            ? { kind: "period", from: selection.from, to: selection.to }
            : { kind: "orders", requested: selection.ids.length },
        ...planned.scope,
      },
    },
    preflight,
    validation: { status: "not-run", reason: "not-requested" },
    assessments: planned.assessments,
    runLimitations,
  };
}
