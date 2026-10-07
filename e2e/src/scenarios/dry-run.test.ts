/**
 * T-214 (D-61): the dry run on the stand, after every other scenario (`vitest.config.ts` runs this file last):
 * the plugin's `medusa exec` script over every order the scenarios placed, on a copy of the stand's database
 * with the plugin's documents and refusals removed — the shop as it was before the plugin issued anything,
 * which is what a merchant checks before installing it. Then the conformance step validates its XML.
 *
 * What the run must show:
 * - the same outcome for each fulfillment as the events gave it on the stand — issued (with the same notice),
 *   or refused with the same code — and the same invoice total; a cancelled fulfillment skipped; a fulfillment
 *   whose order changed after it (an edit, an exchange or claim, a returned item, changed details) not
 *   assessed — the scenarios change many orders after the invoice, and the run reads them as they are now;
 * - an order shipped in two parts and left alone afterwards, placed here: both invoices at the events' totals,
 *   the shipping on the first only — the run's register;
 * - no tool error;
 * - nothing changed: every row of the copy and the File Module's files as before;
 * - no buyer's name, address, postcode, telephone or email in the report.
 */
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { beforeAll, describe, expect, it } from "vitest";
import type { Assessment, DryRunReport, Outcome } from "@normwerk/einvoice-conformance";
import { adminLogin, type AdminSession } from "../api/admin.js";
import { checkoutToOrder } from "../api/checkout.js";
import { fulfillItems } from "../api/fulfillments.js";
import { downloadEinvoiceFile, listEinvoiceDocuments } from "../api/orders.js";
import { getOrderItemValues } from "../api/returns.js";
import { loadCatalog, requireVariantId } from "../seed/catalog.js";
import { waitFor } from "../harness/wait-for.js";
import {
  COPY_DB,
  STAND_DB,
  copyStandDatabase,
  databaseDigest,
  queryRows,
  runDryRun,
  type DryRunResult,
} from "../harness/dry-run.js";

const execFileAsync = promisify(execFile);
const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const CONFORMANCE_CLI = path.join(REPO_ROOT, "packages", "einvoice-conformance", "dist", "cli.js");

interface IssuedInvoice {
  readonly id: string;
  readonly orderId: string;
  readonly notice: string;
}

/** An order shipped in two parts, its two invoices issued, nothing changed after. */
async function placeTwoShipmentOrder(admin: AdminSession): Promise<string> {
  const catalog = await loadCatalog(admin);
  const { orderId } = await checkoutToOrder({
    publishableKey: catalog.publishableKey,
    regionId: catalog.regionId,
    salesChannelId: catalog.salesChannelId,
    variantId: requireVariantId(catalog, "SHIRT-S-BLACK"),
    quantity: 1,
    extraItems: [{ variantId: requireVariantId(catalog, "SWEATSHIRT-M") }],
    shippingOptionId: catalog.shippingOptionId,
    email: "dry-run-buyer@einvoice-e2e.example",
    address: {
      firstName: "Erika",
      lastName: "Musterfrau",
      addressLine1: "Probeweg 21",
      city: "Dresden",
      postalCode: "01067",
      countryCode: "de",
      company: "Musterfrau KG",
    },
  });
  const items = await getOrderItemValues(admin, orderId);
  for (const sku of ["SHIRT-S-BLACK", "SWEATSHIRT-M"]) {
    const item = items.find(({ variantId }) => variantId === requireVariantId(catalog, sku));
    if (item === undefined) throw new Error(`the order has no ${sku} line`);
    await fulfillItems(admin, orderId, catalog.stockLocationId, [{ id: item.id, quantity: 1 }]);
  }
  await waitFor(
    `two invoices for order ${orderId}`,
    async () =>
      (await listEinvoiceDocuments(admin, orderId)).filter(({ type }) => type === "invoice")
        .length >= 2,
    { timeoutMs: 30_000 },
  );
  return orderId;
}

function grandTotal(xml: string): string | undefined {
  return /<ram:GrandTotalAmount>([^<]+)</.exec(xml)?.[1];
}

function invoiceOutcomes(report: DryRunReport): Map<string, Outcome> {
  return new Map(
    report.assessments.flatMap(({ document, outcome }: Assessment) =>
      document.type === "invoice" ? [[document.fulfillmentId, outcome] as const] : [],
    ),
  );
}

describe("dry run over the stand's orders (T-214)", () => {
  let admin: AdminSession;
  let twoShipments: string;
  let run: DryRunResult;
  let report: DryRunReport;
  let digestBefore: string;
  let digestAfter: string;

  beforeAll(async () => {
    admin = await adminLogin();
    twoShipments = await placeTwoShipmentOrder(admin);
    await copyStandDatabase();
    digestBefore = await databaseDigest(COPY_DB);
    run = await runDryRun(["from=2000-01-01", "to=2099-12-31"]);
    digestAfter = await databaseDigest(COPY_DB);
    report = JSON.parse(readFileSync(path.join(run.folder, "report.json"), "utf8")) as DryRunReport;
  }, 300_000);

  it("changes nothing: every row of the shop's database and its files as they were", () => {
    expect(digestAfter).toBe(digestBefore);
    expect(run.filesAfter).toBe(run.filesBefore);
  });

  it("gives each fulfillment the outcome the events gave it, and fails on none", async () => {
    const issued = new Map<string, IssuedInvoice>(
      (
        await queryRows(
          STAND_DB,
          "select idempotency_key, id, order_id, coalesce(notice->>'code', '') from einvoice_document where type = 'invoice'",
        )
      ).map(([key = "", id = "", orderId = "", notice = ""]) => [key, { id, orderId, notice }]),
    );
    const refused = new Map(
      (
        await queryRows(
          STAND_DB,
          "select idempotency_key, code from einvoice_refusal where type = 'invoice'",
        )
      ).map(([key = "", code = ""]) => [key, code]),
    );
    const canceled = new Set(
      (await queryRows(COPY_DB, "select id from fulfillment where canceled_at is not null")).map(
        ([id = ""]) => id,
      ),
    );
    const outcomes = invoiceOutcomes(report);

    const mismatches: string[] = [];
    for (const [fulfillmentId, outcome] of outcomes) {
      const invoice = issued.get(fulfillmentId);
      const refusal = refused.get(fulfillmentId);
      const said = `${fulfillmentId}: the dry run says ${JSON.stringify(outcome)}`;
      switch (outcome.class) {
        case "would-issue":
        case "would-issue-with-notice": {
          const notice = outcome.class === "would-issue-with-notice" ? outcome.notice.code : "";
          if (invoice === undefined) mismatches.push(`${said}, the events issued none`);
          else if (invoice.notice !== notice)
            mismatches.push(`${said}, the events noted "${invoice.notice}"`);
          break;
        }
        case "would-refuse":
          if (refusal !== outcome.refusal.code) {
            mismatches.push(
              `${said}, the events ${invoice ? "issued it" : `refused it as ${refusal}`}`,
            );
          }
          break;
        case "not-assessed":
          if (outcome.limitation !== "ORDER_CHANGED_AFTER_SHIPMENT") mismatches.push(said);
          break;
        case "tool-error":
          mismatches.push(said);
          break;
      }
    }
    for (const fulfillmentId of [...issued.keys(), ...refused.keys()]) {
      if (!outcomes.has(fulfillmentId) && !canceled.has(fulfillmentId)) {
        mismatches.push(
          `${fulfillmentId}: the events issued or refused it, the dry run did not assess it`,
        );
      }
    }
    expect(mismatches).toEqual([]);
    expect([...outcomes.values()].some(({ class: kind }) => kind === "would-issue")).toBe(true);
    expect([...outcomes.values()].some(({ class: kind }) => kind === "would-refuse")).toBe(true);
  });

  it("states each invoice at the total the events issued it at — an order's shipping on its first invoice only", async () => {
    const issued = new Map(
      (
        await queryRows(
          STAND_DB,
          "select idempotency_key, id, order_id from einvoice_document where type = 'invoice'",
        )
      ).map(([key = "", id = "", orderId = ""]) => [key, { id, orderId }]),
    );
    const differences: string[] = [];
    const invoicesPerOrder = new Map<string, number>();
    for (const [fulfillmentId, outcome] of invoiceOutcomes(report)) {
      const invoice = issued.get(fulfillmentId);
      if (
        invoice === undefined ||
        (outcome.class !== "would-issue" && outcome.class !== "would-issue-with-notice")
      ) {
        continue;
      }
      const planned = grandTotal(
        readFileSync(path.join(run.folder, "xml", `${fulfillmentId}.xml`), "utf8"),
      );
      const actual = grandTotal(
        (await downloadEinvoiceFile(admin, invoice.orderId, invoice.id, "xml")).toString("utf8"),
      );
      if (planned !== actual)
        differences.push(`${fulfillmentId}: the dry run ${planned}, the events ${actual}`);
      invoicesPerOrder.set(invoice.orderId, (invoicesPerOrder.get(invoice.orderId) ?? 0) + 1);
    }

    expect(differences).toEqual([]);
    // Both invoices of the order shipped in two parts compared: the run's register carried the first one.
    expect(invoicesPerOrder.get(twoShipments)).toBe(2);
  });

  it("validates every invoice it would issue with KoSIT and Mustang, all valid, and writes the report", async () => {
    await execFileAsync("node", [CONFORMANCE_CLI, "dry-run", run.folder], {
      maxBuffer: 64 * 1024 * 1024,
    });
    const validated = JSON.parse(
      readFileSync(path.join(run.folder, "report.json"), "utf8"),
    ) as DryRunReport;

    expect(validated.validation.status).toBe("ran");
    // The versions the repository pins, never "unknown" — the stand's own lock names no validator.
    expect(validated.validation).toMatchObject({
      tools: [
        { name: "kosit-validator", version: expect.not.stringMatching(/unknown/) },
        {
          name: "xrechnung-validator-configuration",
          version: expect.not.stringMatching(/unknown/),
        },
        { name: "mustang-cli", version: expect.not.stringMatching(/unknown/) },
      ],
    });
    const notValid = validated.assessments.flatMap(({ document, outcome }) =>
      (outcome.class === "would-issue" || outcome.class === "would-issue-with-notice") &&
      (outcome.validation.status !== "ran" ||
        outcome.validation.verdicts.some(({ result }) => result !== "valid"))
        ? [`${document.orderId}: ${JSON.stringify(outcome.validation)}`]
        : [],
    );
    expect(notValid).toEqual([]);
    expect(readFileSync(path.join(run.folder, "report.md"), "utf8")).toContain(
      "# E-invoice dry run",
    );
  });

  it("names no buyer: no name, address, postcode, telephone or email in the report", async () => {
    const personal = (
      await queryRows(
        COPY_DB,
        "select distinct value from (" +
          "select first_name as value from order_address union select last_name from order_address " +
          "union select address_1 from order_address union select address_2 from order_address " +
          "union select city from order_address union select postal_code from order_address " +
          "union select company from order_address union select phone from order_address " +
          'union select email from "order") personal where length(value) >= 4',
      )
    ).map(([value = ""]) => value);
    const written = [
      readFileSync(path.join(run.folder, "report.json"), "utf8"),
      readFileSync(path.join(run.folder, "report.md"), "utf8"),
    ].join("\n");

    expect(personal.length).toBeGreaterThan(10);
    expect(personal.filter((value) => written.includes(value))).toEqual([]);
  });
});
