/**
 * T-214 (D-61): the dry run, run with Medusa's own `exec` — inside the shop's Medusa, with its configuration and
 * database, and without its subscribers, jobs or routes (`medusa exec` loads no entry points). On a staging copy:
 *
 *   npx medusa exec ./node_modules/@normwerk/einvoice-medusa/.medusa/server/src/scripts/einvoice-dry-run.js \
 *     from=2026-09-01 to=2026-09-30 out=einvoice-dry-run
 *
 * Writes `report.json` and the XML (`dry-run/output.ts`); `npx @normwerk/einvoice-conformance dry-run <folder>`
 * validates the XML and writes `report.md`. Logs counts only.
 */
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import type { ExecArgs } from "@medusajs/framework/types";
import { EINVOICE_MODULE } from "../modules/einvoice/index.js";
import type EinvoiceModuleService from "../modules/einvoice/service.js";
import { parseDryRunArgs } from "../dry-run/args.js";
import { writeDryRun } from "../dry-run/output.js";
import { checkPreflight } from "../dry-run/preflight.js";
import { dryRunReport, planOrders } from "../dry-run/run.js";
import { installedVersions } from "../dry-run/versions.js";

export default async function einvoiceDryRun({ container, args }: ExecArgs): Promise<void> {
  const { selection, out } = parseDryRunArgs(args);
  const startedAt = new Date();
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const einvoiceService = container.resolve<EinvoiceModuleService>(EINVOICE_MODULE);

  const preflight = await checkPreflight(container);
  // Without the plugin's tables there are no documents of its own to read; the register starts empty.
  const migrations = preflight.find((check) => check.check === "migrations");
  const planned = await planOrders(container, selection, {
    issuedDocuments: migrations?.status === "pass",
  });
  const report = dryRunReport({
    startedAt,
    versions: installedVersions(),
    selection,
    preflight,
    planned,
    shopPdf: einvoiceService.options.standalone?.basePdf !== undefined,
  });
  writeDryRun(out, report, planned.xml);

  const { scope } = report.header;
  logger.info(
    `einvoice: dry run of ${scope.orders} orders, ${scope.fulfillments} fulfillments — ` +
      `${report.assessments.length} documents assessed, ${planned.xml.size} written as XML to ${out}. ` +
      `Validate them and write the report: npx @normwerk/einvoice-conformance dry-run ${out}`,
  );
}
