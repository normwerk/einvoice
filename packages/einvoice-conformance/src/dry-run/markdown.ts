/**
 * T-214 (D-61): the dry-run report as Markdown, for a merchant or a partner to read. Pure: the same report in,
 * the same text out. Every word comes from the report or is fixed here, so the text carries no more than the
 * JSON does — no personal data (`report.ts`).
 *
 * The run and the shop's setup come before any order (D-61), then the outcomes, refusals first. Each code lists
 * at most `LISTED_PER_CODE` documents; the JSON report lists every one.
 */
import {
  OUTCOME_CLASSES,
  type Assessment,
  type DocumentLimitationCode,
  type DocumentRef,
  type DryRunHeader,
  type DryRunReport,
  type Finding,
  type OutcomeClass,
  type PreflightCheck,
  type PreflightStatus,
  type RunLimitationCode,
  type StackFrame,
  type ToolError,
  type ValidationRun,
  type ValidatorVerdict,
} from "./report.js";

const BUG_FORM_URL = "https://github.com/normwerk/einvoice/issues/new";
const TAX_SEMANTICS_URL = "https://normwerk.dev/einvoice/docs/tax-semantics";
const LISTED_PER_CODE = 20;

const CLASS_LABELS: Readonly<Record<OutcomeClass, string>> = {
  "would-issue": "Would issue",
  "would-issue-with-notice": "Would issue, with a notice",
  "would-refuse": "Would refuse",
  "not-assessed": "Not assessed",
  "tool-error": "Tool error",
};

const STATUS_LABELS: Readonly<Record<PreflightStatus, string>> = {
  pass: "pass",
  warn: "**warn**",
  fail: "**fail**",
  "not-checked": "not checked",
};

const NOT_RUN_REASONS: Readonly<
  Record<Extract<ValidationRun, { status: "not-run" }>["reason"], string>
> = {
  "docker-unavailable": "Docker is not available on the machine that ran the report",
  "images-missing": "the validator images are not built on the machine that ran the report",
  "not-requested": "the report was made without them",
};

const DOCUMENT_LIMITATIONS: Readonly<Record<DocumentLimitationCode, string>> = {
  CREDIT_NOTES_NOT_ASSESSED:
    "This release's dry run plans invoices only: the refunds and cancellations below are listed, not planned.",
  ORDER_EDITED_AFTER_SHIPMENT:
    "These orders were edited after the fulfillment. The run reads an order as it is now, not as it was when " +
    "the invoice would have been issued, so it does not plan the invoice.",
};

const RUN_LIMITATIONS: Readonly<Record<RunLimitationCode, string>> = {
  SHOP_PDF_NOT_ASSESSED:
    "**The shop's own PDF.** The shop renders its own PDF for the invoices. The run does not call it, so " +
    "whether that PDF can become PDF/A-3 is not assessed; the XML is.",
};

const CAUSES: Readonly<Record<string, string>> = {
  "shipping-split-across-rates":
    "the invoice splits shipping across the order's VAT rates, the shop taxes it at one",
};

const STAGES: Readonly<Record<ToolError["stage"], string>> = {
  plan: "while planning the document",
  serialize: "while writing its XML",
  validate: "while validating its XML",
};

const PROFILE_LABELS: Readonly<Record<string, string>> = {
  EN16931: "EN 16931",
  XRECHNUNG: "XRechnung",
};

const VALIDATOR_LABELS: Readonly<Record<ValidatorVerdict["tool"], string>> = {
  kosit: "KoSIT",
  mustang: "Mustang",
};

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

function code(text: string): string {
  return `\`${text}\``;
}

function cell(text: string): string {
  return text.replaceAll("|", "\\|");
}

function names(values: readonly string[]): string {
  return values.map(code).join(", ");
}

function packages(list: readonly { readonly name: string; readonly version: string }[]): string {
  return list.map(({ name, version }) => `${code(name)} ${version}`).join(", ");
}

function frameLine(frame: StackFrame): string {
  return "outside" in frame
    ? `… ${plural(frame.outside, "frame")} outside the @normwerk packages`
    : `at ${frame.function} (${frame.at})`;
}

/** `2026-10-07T12:00:00Z` → `2026-10-07 12:00 UTC`. */
function utcMinute(iso: string): string {
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

function describeDocument(document: DocumentRef): string {
  const order = `Order ${code(document.orderId)}`;
  if (document.type === "invoice") {
    return `${order}, invoice for fulfillment ${code(document.fulfillmentId)}`;
  }
  switch (document.trigger) {
    case "refund":
      return `${order}, credit note for refund ${code(document.refundId)}`;
    case "fulfillment-canceled":
      return `${order}, credit note for cancelled fulfillment ${code(document.fulfillmentId)}`;
    case "order-canceled":
      return `${order}, credit note for the order's cancellation`;
  }
}

function listDocuments(
  assessments: readonly Assessment[],
  suffix: (assessment: Assessment) => string = () => "",
): string[] {
  const listed = assessments
    .slice(0, LISTED_PER_CODE)
    .map((assessment) => `- ${describeDocument(assessment.document)}${suffix(assessment)}`);
  const rest = assessments.length - LISTED_PER_CODE;
  return rest > 0 ? [...listed, `- … and ${rest} more, listed in the JSON report`] : listed;
}

/** Assessments grouped by `keyOf`, the largest group first, then by key. */
function groupBy(
  assessments: readonly Assessment[],
  keyOf: (assessment: Assessment) => string,
): (readonly Assessment[])[] {
  const groups = new Map<string, Assessment[]>();
  for (const assessment of assessments) {
    const key = keyOf(assessment);
    groups.set(key, [...(groups.get(key) ?? []), assessment]);
  }
  return [...groups.entries()]
    .sort(([a, x], [b, y]) => y.length - x.length || a.localeCompare(b))
    .map(([, group]) => group);
}

function ofClass(report: DryRunReport, outcomeClass: OutcomeClass): readonly Assessment[] {
  return report.assessments.filter(({ outcome }) => outcome.class === outcomeClass);
}

function issuable(report: DryRunReport): readonly Assessment[] {
  return report.assessments.filter(
    ({ outcome }) => outcome.class === "would-issue" || outcome.class === "would-issue-with-notice",
  );
}

type ValidationState = "valid" | "warnings" | "invalid" | "not-run";

function validationOf({ outcome }: Assessment): {
  readonly state: ValidationState;
  readonly verdicts: readonly ValidatorVerdict[];
} {
  if (outcome.class !== "would-issue" && outcome.class !== "would-issue-with-notice") {
    return { state: "not-run", verdicts: [] };
  }
  if (outcome.validation.status === "not-run") return { state: "not-run", verdicts: [] };
  const { verdicts } = outcome.validation;
  const state = verdicts.some(({ result }) => result === "invalid")
    ? "invalid"
    : verdicts.some(({ result }) => result === "warnings")
      ? "warnings"
      : "valid";
  return { state, verdicts };
}

function title(header: DryRunHeader): string[] {
  return [
    "# E-invoice dry run",
    "",
    `${code(header.plugin.name)} ${header.plugin.version} on ${header.platform.name} ` +
      `${header.platform.version}, started ${utcMinute(header.startedAt)}.`,
    "",
    "What the plugin would have done with these orders had it been running: the documents it would issue, " +
      "issue with a notice or refuse, and why. Nothing was issued — no document number was taken, no file " +
      "stored, no event sent. This is a technical check of the shop's data and setup, not tax advice.",
  ];
}

function validators(validation: ValidationRun): string {
  return validation.status === "ran"
    ? validation.tools.map(({ name, version }) => `${name} ${version}`).join("; ")
    : `not run — ${NOT_RUN_REASONS[validation.reason]}`;
}

function run(report: DryRunReport): string[] {
  const { header } = report;
  const { scope } = header;
  const selection =
    scope.selection.kind === "period"
      ? `fulfillments created from ${scope.selection.from} to ${scope.selection.to}`
      : `${plural(scope.selection.requested, "order")} named for the run`;
  const checks = scope.vatIdChecks;
  return [
    "## Run",
    "",
    `- **Selection:** ${selection} — ${plural(scope.orders, "order")}, ` +
      `${plural(scope.fulfillments, "fulfillment")}.`,
    `- **Skipped:** ${plural(scope.skipped.alreadyInvoiced, "fulfillment")} already invoiced by the ` +
      `plugin, ${scope.skipped.canceled} cancelled before an invoice was issued.`,
    checks.distinct === 0
      ? "- **VAT-IDs:** none checked."
      : `- **VAT-IDs:** ${checks.distinct} distinct checked — ${checks.confirmed} confirmed, ` +
        `${checks.notConfirmed} not confirmed; for ${checks.unavailable} the verifier gave no answer.`,
    `- **Plugin:** ${packages([header.plugin])}; core ${packages(header.core)}.`,
    `- **VAT rules:** SHA-256 ${code(header.rulesSha256)}.`,
    `- **Platform:** ${header.platform.name} ${header.platform.version}, Node.js ${header.nodeVersion}.`,
    `- **Validators:** ${validators(report.validation)}.`,
    `- **Report format:** version ${report.schemaVersion}.`,
  ];
}

function preflightRow(check: PreflightCheck, platform: string): readonly [string, string] {
  switch (check.check) {
    case "platform-version":
      return [
        `${platform} version`,
        check.installed === null
          ? `Could not be determined; the plugin runs on ${check.supported}`
          : check.status === "fail"
            ? `${check.installed} is not supported: the plugin runs on ${check.supported} and does not ` +
              "start on another release"
            : `${check.installed}; the plugin runs on ${check.supported}`,
      ];
    case "migrations":
      return [
        "Plugin migrations",
        check.pending.length === 0 ? "All applied" : `Not applied: ${names(check.pending)}`,
      ];
    case "plugin-options":
      return [
        "Plugin options",
        check.invalid.length === 0
          ? "Complete"
          : `Missing or invalid: ${names(check.invalid)} — the plugin does not start ` +
            `(${code("INVALID_PLUGIN_OPTIONS")})`,
      ];
    case "tax-rates":
      return [
        "VAT rates",
        check.withoutVat.length === 0
          ? "Every tax region charges VAT"
          : `No VAT charged in the tax region of ${check.withoutVat.join(", ")}: a domestic order ` +
            `there is refused (${code("NO_VAT_CHARGED")})`,
      ];
    case "other-invoice-plugins":
      return [
        "Other invoice plugins",
        check.plugins.length === 0
          ? "None"
          : `${names(check.plugins)}: with both running, a sale gets two invoices, and the VAT stated ` +
            "on each is owed",
      ];
    case "file-storage":
      return [
        "File storage",
        check.provider === null
          ? "No file provider: the plugin cannot store the documents it issues"
          : code(check.provider),
      ];
    case "vat-id-verifier":
      return [
        "VAT-ID verifier",
        check.configured
          ? "Configured"
          : "Not configured: an intra-EU supply to a business is refused unless its VAT-ID is " +
            `confirmed by hand (${code("VAT_ID_UNVERIFIED")})`,
      ];
  }
}

function shopSetup(report: DryRunReport): string[] {
  const rows = report.preflight.map((check) => {
    const [label, details] = preflightRow(check, report.header.platform.name);
    return [
      label,
      STATUS_LABELS[check.status],
      check.status === "not-checked" ? "Could not be checked" : details,
    ];
  });
  const { validation } = report;
  rows.push(
    validation.status === "ran"
      ? ["Validators", STATUS_LABELS.pass, "Ran; their versions are under Run"]
      : ["Validators", STATUS_LABELS.warn, `Not run: ${NOT_RUN_REASONS[validation.reason]}`],
  );
  return [
    "## Shop setup",
    "",
    "| Check | Result | Details |",
    "| --- | --- | --- |",
    ...rows.map((row) => `| ${row.map(cell).join(" | ")} |`),
  ];
}

function validationSummary(report: DryRunReport): string {
  const documents = issuable(report);
  const counts: Record<ValidationState, number> = {
    valid: 0,
    warnings: 0,
    invalid: 0,
    "not-run": 0,
  };
  for (const assessment of documents) counts[validationOf(assessment).state] += 1;
  if (counts["not-run"] === documents.length) {
    return report.validation.status === "not-run"
      ? `Not validated: ${NOT_RUN_REASONS[report.validation.reason]}. Not validated is not the same as ` +
          "valid."
      : "Not validated: no document was given to the validators.";
  }
  const notRun = counts["not-run"] > 0 ? `, ${counts["not-run"]} not validated` : "";
  const see = counts.invalid + counts.warnings > 0 ? " — see Validation" : "";
  return (
    `Validated: of the ${plural(documents.length, "document")} the plugin would issue, ` +
    `${counts.valid} valid, ${counts.warnings} valid with warnings, ${counts.invalid} invalid${notRun}${see}.`
  );
}

function outcomes(report: DryRunReport): string[] {
  return [
    "## Outcomes",
    "",
    "| Outcome | Documents |",
    "| --- | ---: |",
    ...OUTCOME_CLASSES.map(
      (outcomeClass) =>
        `| ${CLASS_LABELS[outcomeClass]} | ${ofClass(report, outcomeClass).length} |`,
    ),
    `| **All** | **${report.assessments.length}** |`,
    "",
    validationSummary(report),
  ];
}

function findingSuffix(finding: Finding): string {
  const country = finding.country === undefined ? "" : ` — buyer in ${finding.country}`;
  const cause = finding.cause === undefined ? "" : ` — ${CAUSES[finding.cause] ?? finding.cause}`;
  return `${country}${cause}`;
}

function findingSection(
  heading: string,
  intro: string,
  assessments: readonly Assessment[],
  findingOf: (assessment: Assessment) => Finding,
): string[] {
  const lines = [`## ${heading}`, "", intro];
  if (assessments.length === 0) return [...lines, "", "None."];
  for (const group of groupBy(assessments, (assessment) => findingOf(assessment).code)) {
    const [first] = group;
    if (first === undefined) continue;
    const finding = findingOf(first);
    lines.push(
      "",
      `### ${code(finding.code)} — ${group.length}`,
      "",
      `${finding.reason} [What to do](${finding.docsUrl}).`,
      "",
      ...listDocuments(group, (assessment) => findingSuffix(findingOf(assessment))),
    );
  }
  return lines;
}

function refusalOf({ outcome }: Assessment): Finding {
  if (outcome.class !== "would-refuse") throw new Error(`not a refusal: ${outcome.class}`);
  return outcome.refusal;
}

function noticeOf({ outcome }: Assessment): Finding {
  if (outcome.class !== "would-issue-with-notice")
    throw new Error(`not a notice: ${outcome.class}`);
  return outcome.notice;
}

function toolErrorOf({ outcome }: Assessment): ToolError {
  if (outcome.class !== "tool-error") throw new Error(`not a tool error: ${outcome.class}`);
  return outcome.error;
}

/** The repository's bug form, filled in with the versions, the code and the stack — nothing of the order. */
export function toolErrorReportUrl(header: DryRunHeader, error: ToolError): string {
  const params = new URLSearchParams({
    template: "bug.yml",
    title: `Dry run: ${error.code} (${error.errorClass}), fingerprint ${error.fingerprint}`,
    versions: [header.plugin, ...header.core]
      .map(({ name, version }) => `${name} ${version}`)
      .join(", "),
    platform: `${header.platform.name} ${header.platform.version}, Node.js ${header.nodeVersion}`,
    code: error.code,
    what: [
      `The dry run failed ${STAGES[error.stage]}.`,
      "",
      "```text",
      `${error.errorClass} [${error.code}]`,
      ...error.stack.map((frame) => `    ${frameLine(frame)}`),
      "```",
    ].join("\n"),
  });
  return `${BUG_FORM_URL}?${params.toString()}`;
}

function toolErrors(report: DryRunReport): string[] {
  const assessments = ofClass(report, "tool-error");
  if (assessments.length === 0) {
    return ["## Tool errors", "", "None: the run planned every document without failing."];
  }
  const lines = [
    "## Tool errors",
    "",
    "The dry run failed on these documents. That is a defect in the plugin — what the run is there to " +
      "find. Please report each one: the link opens a form filled in with the versions, the code and the " +
      "stack below, and nothing from the order.",
  ];
  for (const group of groupBy(assessments, (assessment) => toolErrorOf(assessment).fingerprint)) {
    const [first] = group;
    if (first === undefined) continue;
    const error = toolErrorOf(first);
    lines.push(
      "",
      `### ${code(error.code)}, ${code(error.errorClass)} — ${group.length}`,
      "",
      `Fingerprint ${code(error.fingerprint)}, ${STAGES[error.stage]}.`,
      "",
      "```text",
      ...error.stack.map(frameLine),
      "```",
      "",
      `[Report it](${toolErrorReportUrl(report.header, error)})`,
      "",
      ...listDocuments(group),
    );
  }
  return lines;
}

function notAssessed(report: DryRunReport): string[] {
  const assessments = ofClass(report, "not-assessed");
  const lines = [
    "## Not assessed",
    "",
    "What this dry run cannot judge — a limit of the run, not a finding about the shop.",
  ];
  if (assessments.length === 0) return [...lines, "", "None."];
  const limitationOf = ({ outcome }: Assessment): DocumentLimitationCode => {
    if (outcome.class !== "not-assessed") throw new Error(`not assessed: ${outcome.class}`);
    return outcome.limitation;
  };
  for (const group of groupBy(assessments, limitationOf)) {
    const [first] = group;
    if (first === undefined) continue;
    const limitation = limitationOf(first);
    lines.push(
      "",
      `### ${code(limitation)} — ${group.length}`,
      "",
      DOCUMENT_LIMITATIONS[limitation],
      "",
      ...listDocuments(group),
    );
  }
  return lines;
}

function wouldIssue(report: DryRunReport): string[] {
  const profiles = new Map<string, { plain: number; notice: number }>();
  for (const { outcome } of issuable(report)) {
    if (outcome.class !== "would-issue" && outcome.class !== "would-issue-with-notice") continue;
    const counts = profiles.get(outcome.profile) ?? { plain: 0, notice: 0 };
    if (outcome.class === "would-issue") counts.plain += 1;
    else counts.notice += 1;
    profiles.set(outcome.profile, counts);
  }
  const lines = ["## Would issue", ""];
  if (profiles.size === 0) return [...lines, "None."];
  const rows = [...profiles.entries()]
    .sort(([a, x], [b, y]) => y.plain + y.notice - (x.plain + x.notice) || a.localeCompare(b))
    .map(
      ([profile, counts]) =>
        `| ${cell(PROFILE_LABELS[profile] ?? profile)} | ${counts.plain} | ${counts.notice} |`,
    );
  return [
    ...lines,
    "| Profile | Would issue | With a notice |",
    "| --- | ---: | ---: |",
    ...rows,
    "",
    "Each document is listed in the JSON report.",
  ];
}

function verdictSuffix(verdicts: readonly ValidatorVerdict[]): string {
  const fired = verdicts
    .filter(({ rules }) => rules.length > 0)
    .map(({ tool, rules }) => `${VALIDATOR_LABELS[tool]}: ${rules.join(", ")}`);
  return fired.length === 0 ? "" : ` — ${fired.join("; ")}`;
}

function validation(report: DryRunReport): string[] {
  const lines = ["## Validation", ""];
  if (report.validation.status === "not-run") {
    return [
      ...lines,
      `Not validated: ${NOT_RUN_REASONS[report.validation.reason]}. The documents were not checked ` +
        "against the official validators — which is not the same as valid.",
    ];
  }
  lines.push(
    "The XML of every document the plugin would issue went through the validators listed under Run, with " +
      "a placeholder for the document number, which the plugin takes only when it issues.",
  );
  const documents = issuable(report);
  const sections: readonly [ValidationState, string, string][] = [
    [
      "invalid",
      "Invalid",
      "The plugin would issue these documents, and the validators reject them: a defect in the plugin. " +
        `Please report it on the [bug form](${BUG_FORM_URL}?template=bug.yml) with the rule ids below — ` +
        "never with the document.",
    ],
    [
      "warnings",
      "Valid with warnings",
      "The validators accept these documents, with warnings on the rules below.",
    ],
  ];
  let flagged = 0;
  for (const [state, heading, intro] of sections) {
    const group = documents.filter((assessment) => validationOf(assessment).state === state);
    if (group.length === 0) continue;
    flagged += group.length;
    lines.push(
      "",
      `### ${heading} — ${group.length}`,
      "",
      intro,
      "",
      ...listDocuments(group, (assessment) => verdictSuffix(validationOf(assessment).verdicts)),
    );
  }
  if (flagged === 0) lines.push("", "Every one is valid.");
  return lines;
}

function notCovered(report: DryRunReport): string[] {
  return [
    "## What this report does not tell you",
    "",
    "- **Whether the VAT is right.** Validators check a document's structure and business rules, not " +
      "whether the VAT category, rate or exemption is the right one for the sale: a document with the wrong " +
      "category can pass them. What the plugin decides, and on which grounds: " +
      `[tax semantics](${TAX_SEMANTICS_URL}).`,
    "- **VAT-IDs as they were.** The verifier answers for the day of the run, not for the day of the order.",
    ...report.runLimitations.map((limitation) => `- ${RUN_LIMITATIONS[limitation]}`),
    "- **Tax advice.** This is a technical check. Questions about the VAT treatment of a sale go to the " +
      "merchant's own tax advisor.",
  ];
}

export function renderDryRunMarkdown(report: DryRunReport): string {
  const sections = [
    title(report.header),
    run(report),
    shopSetup(report),
    outcomes(report),
    findingSection(
      "Would refuse",
      "The plugin would not issue these documents. It records why and takes no document number; the " +
        "merchant corrects the order and retries, or issues the document another way.",
      ofClass(report, "would-refuse"),
      refusalOf,
    ),
    findingSection(
      "Would issue, with a notice",
      "The plugin would issue these documents and tell the merchant something to act on.",
      ofClass(report, "would-issue-with-notice"),
      noticeOf,
    ),
    toolErrors(report),
    notAssessed(report),
    wouldIssue(report),
    validation(report),
    notCovered(report),
  ];
  return `${sections.map((lines) => lines.join("\n")).join("\n\n")}\n`;
}
