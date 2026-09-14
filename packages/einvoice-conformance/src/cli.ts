#!/usr/bin/env node
/**
 * `pnpm conformance validate <file>` — spike C (plan-v0.1 §3.2, T-044)
 * minimal slice: run the right Docker validator for the file and print one
 * machine-readable JSON report to stdout.
 *
 * This is intentionally small. The full CLI (`validate --level`, `diff`,
 * `roundtrip`, `report --out`, per plan-v0.1 §4.5) is T-040, once fixtures
 * (T-050) and a serializer (T-020) exist to run it against. What's here
 * only has to prove the Docker pipeline is reproducible and its output is
 * parseable — which is the spike's actual success criterion.
 *
 * Images must be built first (not part of this command — building is a
 * one-time, cacheable step):
 *   docker compose -f docker/compose.conformance.yml build
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, basename, resolve, extname } from "node:path";
// Explicit .js extension: this file is run directly with `node dist/cli.js`
// (not through vitest/a bundler), so Node's ESM resolver needs it even
// though the source is kosit-report.ts (moduleResolution: Bundler allows
// this — see tsconfig.base.json).
import { parseKositReport } from "./kosit-report.js";

const KOSIT_IMAGE = "einvoice-conformance-kosit:local";
const VERAPDF_IMAGE = "einvoice-conformance-verapdf:local";

interface ValidationResult {
  readonly tool: string;
  readonly file: string;
  readonly valid: boolean;
  /** KoSIT only: its own accept/reject business verdict, distinct from `valid` (see `kosit-report.ts`'s
   * `KositReport.accepted` doc comment — a warning-only document can be `accepted: true` while `valid:
   * false`). Not applicable to veraPDF's binary compliant/non-compliant result. */
  readonly accepted?: boolean;
  readonly durationMs: number;
  readonly messages: readonly { level: string; code: string | null; text: string }[];
}

/**
 * Both validators exit non-zero to signal "document rejected/non-compliant",
 * not just "tool failed to run" — so a non-zero exit is not itself an
 * error here. `execFileSync` throws either way; the thrown error still
 * carries `stdout`/`stderr`, which is what we actually need to parse.
 */
function runDocker(
  image: string,
  hostDir: string,
  args: readonly string[],
  { readOnly }: { readOnly: boolean },
): string {
  const mount = readOnly ? `${hostDir}:/data:ro` : `${hostDir}:/data`;
  try {
    return execFileSync("docker", ["run", "--rm", "-v", mount, image, ...args], {
      encoding: "utf-8",
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (error) {
    const stdout = (error as { stdout?: string }).stdout;
    if (typeof stdout === "string") {
      return stdout;
    }
    throw error;
  }
}

function validateXml(filePath: string): ValidationResult {
  const dir = dirname(filePath);
  const name = basename(filePath);
  const started = Date.now();
  // The report file is what we actually parse; stdout is just the
  // human-readable console summary.
  runDocker(KOSIT_IMAGE, dir, ["-h", `/data/${name}`], { readOnly: false });
  const durationMs = Date.now() - started;

  // The validator writes `<name>-report.xml` next to the input in the same
  // mounted (read-write) directory.
  const reportPath = resolve(dir, `${name.replace(/\.xml$/i, "")}-report.xml`);
  const reportXml = readFileSync(reportPath, "utf-8");
  const { valid, accepted, messages } = parseKositReport(reportXml);

  return { tool: "kosit", file: filePath, valid, accepted, durationMs, messages };
}

interface VeraPdfReport {
  report?: {
    batchSummary?: {
      validationSummary?: {
        compliantPdfaCount: number;
        nonCompliantPdfaCount: number;
        failedJobCount: number;
      };
    };
  };
}

function validatePdf(filePath: string): ValidationResult {
  const dir = dirname(filePath);
  const name = basename(filePath);
  const started = Date.now();
  const stdout = runDocker(
    VERAPDF_IMAGE,
    dir,
    ["--flavour", "3b", "--format", "json", `/data/${name}`],
    {
      readOnly: true,
    },
  );
  const durationMs = Date.now() - started;

  const jsonStart = stdout.indexOf("{");
  const report = JSON.parse(stdout.slice(jsonStart)) as VeraPdfReport;
  const summary = report.report?.batchSummary?.validationSummary;
  const valid =
    summary !== undefined && summary.compliantPdfaCount > 0 && summary.failedJobCount === 0;

  return {
    tool: "verapdf",
    file: filePath,
    valid,
    durationMs,
    messages: summary
      ? [{ level: "info", code: null, text: JSON.stringify(summary) }]
      : [{ level: "error", code: null, text: "no validationSummary in veraPDF output" }],
  };
}

function main(): void {
  const [command, file] = process.argv.slice(2);
  if (command !== "validate" || file === undefined) {
    console.error("Usage: pnpm conformance validate <file.xml|file.pdf>");
    process.exitCode = 1;
    return;
  }

  const filePath = resolve(file);
  const ext = extname(filePath).toLowerCase();
  const result = ext === ".pdf" ? validatePdf(filePath) : validateXml(filePath);

  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.valid ? 0 : 1;
}

main();
