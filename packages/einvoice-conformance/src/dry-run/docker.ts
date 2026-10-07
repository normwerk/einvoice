/**
 * T-214: the validators of the dry run's second step, run in this repository's Docker images
 * (`docker compose -f docker/compose.conformance.yml build kosit mustang`): KoSIT over every file in one
 * container — its JVM starts once — writing its reports to a scratch folder, not beside the shop's XML; Mustang
 * once per file, without a PDF. Their versions are the ones `docker/images.lock` pins.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseKositReport, type KositReport } from "../kosit-report.js";
import type { ValidatorTool } from "./report.js";
import type { Validators } from "./validate.js";

export const KOSIT_IMAGE = "einvoice-conformance-kosit:local";
export const MUSTANG_IMAGE = "einvoice-conformance-mustang:local";

/** Files per KoSIT container — a command line stays well below the system's limit. */
const KOSIT_BATCH = 200;
/** The validators of a dry run, as `docker/images.lock` names them. */
const DRY_RUN_TOOLS = ["kosit-validator", "xrechnung-validator-configuration", "mustang-cli"];

export function dockerAvailable(): boolean {
  return spawnSync("docker", ["info"], { stdio: "ignore" }).status === 0;
}

export function imagesPresent(images: readonly string[] = [KOSIT_IMAGE, MUSTANG_IMAGE]): boolean {
  return images.every(
    (image) => spawnSync("docker", ["image", "inspect", image], { stdio: "ignore" }).status === 0,
  );
}

interface ImagesLock {
  readonly tools?: readonly {
    readonly name: string;
    readonly version: string;
    readonly sha256: string;
  }[];
}

/** The pinned versions, from the repository's `docker/images.lock` — beside the working folder or this
 * package. Without it, the tools are named with their versions unknown. */
export function validatorTools(): readonly ValidatorTool[] {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const lockFile = [
    path.resolve(process.cwd(), "docker/images.lock"),
    path.resolve(here, "../../../../docker/images.lock"),
  ].find((candidate) => existsSync(candidate));
  const lock: ImagesLock =
    lockFile === undefined ? {} : (JSON.parse(readFileSync(lockFile, "utf8")) as ImagesLock);
  return DRY_RUN_TOOLS.map((name) => {
    const tool = lock.tools?.find((candidate) => candidate.name === name);
    return { name, version: tool?.version ?? "unknown", sha256: tool?.sha256 ?? "unknown" };
  });
}

function kositReports(xmlDir: string, files: readonly string[]): ReadonlyMap<string, KositReport> {
  const out = mkdtempSync(path.join(tmpdir(), "einvoice-dry-run-kosit-"));
  try {
    const reports = new Map<string, KositReport>();
    for (let start = 0; start < files.length; start += KOSIT_BATCH) {
      const batch = files.slice(start, start + KOSIT_BATCH);
      // KoSIT exits non-zero when it rejects a document; the reports are what is read.
      spawnSync(
        "docker",
        [
          "run",
          "--rm",
          "-v",
          `${xmlDir}:/data:ro`,
          "-v",
          `${out}:/out`,
          KOSIT_IMAGE,
          "-o",
          "/out",
          ...batch.map((file) => `/data/${path.basename(file)}`),
        ],
        { stdio: "ignore" },
      );
      for (const file of batch) {
        const reportFile = path.join(out, `${path.basename(file, ".xml")}-report.xml`);
        if (existsSync(reportFile)) {
          reports.set(file, parseKositReport(readFileSync(reportFile, "utf8")));
        }
      }
    }
    return reports;
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}

function mustangOutput(xmlDir: string, file: string): string {
  try {
    return execFileSync(
      "docker",
      [
        "run",
        "--rm",
        "-v",
        `${xmlDir}:/data:ro`,
        MUSTANG_IMAGE,
        "--action",
        "validate",
        "--source",
        `/data/${path.basename(file)}`,
      ],
      { encoding: "utf-8", maxBuffer: 16 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] },
    );
  } catch (error) {
    // Mustang exits non-zero for an invalid document: its report is still on stdout.
    const stdout = (error as { readonly stdout?: unknown }).stdout;
    if (typeof stdout === "string" && stdout.includes("<summary")) return stdout;
    throw error;
  }
}

export function dockerValidators(xmlDir: string): Validators {
  return {
    tools: validatorTools(),
    kosit: (files) => kositReports(xmlDir, files),
    mustang: (file) => mustangOutput(xmlDir, file),
  };
}
