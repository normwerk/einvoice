/**
 * T-214: `pnpm conformance dry-run <folder>` — the second step of a dry run, on the folder the plugin wrote:
 * validates the XML of each invoice it would issue, puts the verdicts into `report.json` and writes
 * `report.md`. Without Docker, or without the validator images, the report says the validators did not run,
 * and why; it never counts a document as valid that no validator saw.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { dockerAvailable, dockerValidators, imagesPresent } from "./docker.js";
import { renderDryRunMarkdown } from "./markdown.js";
import { DRY_RUN_REPORT_SCHEMA_VERSION, type DryRunReport, type ValidationRun } from "./report.js";
import { validateDryRun } from "./validate.js";

function notRun(
  report: DryRunReport,
  reason: Extract<ValidationRun, { status: "not-run" }>["reason"],
): DryRunReport {
  return { ...report, validation: { status: "not-run", reason } };
}

/** Writes the folder's report; the exit code — 0 once written, 2 for a folder without a report this reads. */
export function dryRunCommand(folder: string): number {
  const reportFile = path.join(folder, "report.json");
  if (!existsSync(reportFile)) {
    console.error(`${folder} holds no report.json: run the plugin's dry run first.`);
    return 2;
  }
  const report = JSON.parse(readFileSync(reportFile, "utf8")) as DryRunReport;
  if (report.schemaVersion !== DRY_RUN_REPORT_SCHEMA_VERSION) {
    console.error(
      `report.json is in format version ${String(report.schemaVersion)}; this package reads version ` +
        `${DRY_RUN_REPORT_SCHEMA_VERSION}. Use the release of @normwerk/einvoice-conformance that matches the plugin.`,
    );
    return 2;
  }
  const xmlDir = path.join(folder, "xml");
  const validated = !dockerAvailable()
    ? notRun(report, "docker-unavailable")
    : !imagesPresent()
      ? notRun(report, "images-missing")
      : validateDryRun(report, xmlDir, dockerValidators(xmlDir));

  writeFileSync(reportFile, `${JSON.stringify(validated, null, 2)}\n`);
  writeFileSync(path.join(folder, "report.md"), renderDryRunMarkdown(validated));
  console.error(
    `wrote ${path.join(folder, "report.md")}: ${validated.assessments.length} documents, validators ` +
      (validated.validation.status === "ran" ? "ran" : `not run (${validated.validation.reason})`),
  );
  return 0;
}
