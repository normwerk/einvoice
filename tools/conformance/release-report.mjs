#!/usr/bin/env node
/**
 * The conformance report attached to every GitHub release (plan-v0.1 §10: "Отчёт конформанса приложен к
 * релизу"). Runs every conformance level against the release's own commit and writes one Markdown file with
 * the result of each, the validators that produced it, and what the levels do not check. Exits non-zero if
 * any level fails, so `release.yml` publishes nothing to npm from a red run.
 *
 * Usage: `node tools/conformance/release-report.mjs <out.md>` — after `pnpm build` and with the validator
 * images built (`docker compose -f docker/compose.conformance.yml build kosit mustang verapdf`).
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const LEVELS = [
  {
    script: "conformance:fixtures",
    level: "L1+L2",
    what: "Fixtures through KoSIT (XSD + Schematron)",
  },
  { script: "conformance:commerce", level: "L1+L2", what: "`buildInvoice` fixtures through KoSIT" },
  {
    script: "conformance:tax-matrix",
    level: "L1+L2",
    what: "Tax-matrix cells, from a Medusa order through the adapter, KoSIT three times",
  },
  { script: "conformance:pdfa", level: "L3", what: "PDF/A-3b through veraPDF and Mustang" },
  {
    script: "conformance:oracle-eu",
    level: "L4",
    what: "Differential against `@e-invoice-eu/core`, every difference classified",
  },
  {
    script: "conformance:oracle-facturx",
    level: "L4",
    what: "Differential against `@stackforge-eu/factur-x`, every difference classified",
  },
  {
    script: "conformance:roundtrip",
    level: "L5",
    what: "Mustang reads the XML back; totals and key terms compared with the model",
  },
];

/** The summary line a conformance script ends with, e.g. "14/14 fixtures pass L1+L2 (KoSIT)." */
function summaryOf(output) {
  const lines = output.split("\n").filter((line) => /^\d+\/\d+ /.test(line.trim()));
  return lines.at(-1)?.trim() ?? "no summary line — see the job log";
}

function git(args) {
  return spawnSync("git", args, { cwd: REPO_ROOT, encoding: "utf-8" }).stdout.trim();
}

function main() {
  const out = process.argv[2];
  if (out === undefined) {
    console.error("usage: node tools/conformance/release-report.mjs <out.md>");
    process.exit(2);
  }
  const results = LEVELS.map((level) => {
    console.error(`running ${level.script} …`);
    const run = spawnSync("pnpm", ["-s", level.script], {
      cwd: REPO_ROOT,
      encoding: "utf-8",
      maxBuffer: 64 * 1024 * 1024,
    });
    const passed = run.status === 0;
    const summary = summaryOf(`${run.stdout}\n${run.stderr}`);
    console.error(`  ${passed ? "PASS" : "FAIL"} ${summary}`);
    return { ...level, passed, summary };
  });

  const lock = JSON.parse(readFileSync(resolve(REPO_ROOT, "docker/images.lock"), "utf-8"));
  const commit = git(["rev-parse", "HEAD"]);
  const tag = git(["describe", "--tags", "--exact-match"]) || "(untagged)";
  const allPassed = results.every((r) => r.passed);

  const report = [
    "# Conformance report",
    "",
    `Release ${tag}, commit \`${commit}\`. ${allPassed ? "Every level passed." : "**At least one level failed.**"}`,
    "",
    "| Level | What | Result | Summary |",
    "| ----- | ---- | ------ | ------- |",
    ...results.map(
      (r) =>
        `| ${r.level} | ${r.what} | ${r.passed ? "pass" : "**FAIL**"} | ${r.summary.replace(/\|/g, "\\|")} |`,
    ),
    "",
    "## Validators",
    "",
    "| Tool | Version | SHA-256 of the file installed |",
    "| ---- | ------- | ----------------------------- |",
    ...lock.tools.map((tool) => `| ${tool.name} | ${tool.version} | \`${tool.sha256}\` |`),
    "",
    `Base image: \`${lock.baseImage.ref}@${lock.baseImage.digest}\`.`,
    "",
    "## What this does not check",
    "",
    "Validators check a document's structure and business rules. They do not check whether the VAT category,",
    "rate or exemption is the right one for the sale — a document with the wrong category can pass every level",
    "above. That is covered by the scenario fixtures and the tax matrix, and the limits are listed in",
    "[`docs/tax-semantics.md`](https://github.com/normwerk/einvoice/blob/main/docs/tax-semantics.md). This",
    "report is not tax advice.",
    "",
  ].join("\n");
  writeFileSync(out, report);
  console.error(`wrote ${out}`);
  if (!allPassed) process.exitCode = 1;
}

main();
