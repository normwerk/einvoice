/**
 * T-214: the dry run's second step — the XML of every invoice the plugin would issue through the validators,
 * each verdict into the report. The validators themselves are handed in (`docker.ts` runs the real ones), so
 * this is the same whether they run in Docker or in a test.
 *
 * A document whose XML is missing from the folder stays "not validated"; one a validator fails on — the tool,
 * not the document — becomes a tool error. Neither is ever counted as valid.
 */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import type { KositReport } from "../kosit-report.js";
import type { Assessment, DryRunReport, ToolError, ValidatorTool } from "./report.js";
import { kositVerdict, mustangVerdict } from "./verdicts.js";

export interface Validators {
  readonly tools: readonly ValidatorTool[];
  /** KoSIT's report for each file, by the path given. */
  kosit(files: readonly string[]): ReadonlyMap<string, KositReport>;
  /** Mustang's `--action validate` output for one file. */
  mustang(file: string): string;
}

/** The plugin's name for an invoice's XML in the folder's `xml/` (`einvoice-medusa`'s `dry-run/output.ts`). */
export function xmlFileName(fulfillmentId: string): string {
  return `${fulfillmentId.replace(/[^A-Za-z0-9_-]/g, "_")}.xml`;
}

function validatorFailed(error: unknown): ToolError {
  const errorClass = error instanceof Error ? error.name : typeof error;
  return {
    stage: "validate",
    code: "INTERNAL_ERROR",
    errorClass,
    stack: [],
    fingerprint: createHash("sha256").update(`validate\n${errorClass}`).digest("hex").slice(0, 12),
  };
}

export function validateDryRun(
  report: DryRunReport,
  xmlDir: string,
  validators: Validators,
): DryRunReport {
  const fileOf = ({ document, outcome }: Assessment): string | undefined =>
    document.type === "invoice" &&
    (outcome.class === "would-issue" || outcome.class === "would-issue-with-notice")
      ? path.join(xmlDir, xmlFileName(document.fulfillmentId))
      : undefined;
  const files = report.assessments
    .map(fileOf)
    .filter((file): file is string => file !== undefined && existsSync(file));
  const kosit = files.length === 0 ? new Map<string, KositReport>() : validators.kosit(files);

  const assessments = report.assessments.map((assessment): Assessment => {
    const file = fileOf(assessment);
    const { outcome } = assessment;
    if (
      file === undefined ||
      !files.includes(file) ||
      (outcome.class !== "would-issue" && outcome.class !== "would-issue-with-notice")
    ) {
      return assessment;
    }
    try {
      const kositReport = kosit.get(file);
      if (kositReport === undefined) throw new Error("KoSIT wrote no report for the document");
      const verdicts = [kositVerdict(kositReport), mustangVerdict(validators.mustang(file))];
      return { ...assessment, outcome: { ...outcome, validation: { status: "ran", verdicts } } };
    } catch (error) {
      return { ...assessment, outcome: { class: "tool-error", error: validatorFailed(error) } };
    }
  });

  return { ...report, validation: { status: "ran", tools: validators.tools }, assessments };
}
