#!/usr/bin/env node
/**
 * T-117: the Docker half of the tax-matrix gate. `pnpm --filter @normwerk/einvoice-medusa test` already
 * proves every cell's build/profile axis for free (no Docker needed — those are error/category assertions
 * against real, unmocked adapter functions, `packages/einvoice-medusa/src/tax-matrix/tax-matrix.test.ts`).
 * This script covers what that fast suite cannot: that a cell whose build axis expects `{ kind: "ok" }`
 * really produces XML the real KoSIT validator accepts — AGENTS.md §8, "never simulate conformance".
 *
 * Only cells with `expected.build.kind === "ok"` are driven through `serializeCii` + KoSIT here; every
 * other cell (error/known-bug) never reaches serialization and is already fully proven by the fast suite.
 *
 * Runs the whole "validated" set three times in one invocation and asserts byte-identical XML and identical
 * verdicts across all three runs — T-117's own determinism acceptance criterion, not just a single pass.
 *
 * Requires: `pnpm --filter @normwerk/einvoice-model build`, `pnpm --filter @normwerk/einvoice-commerce
 * build`, `pnpm --filter @normwerk/einvoice-cii build`, and the KoSIT image built (`docker compose -f
 * docker/compose.conformance.yml build kosit`) — same preconditions as `conformance:commerce`.
 *
 * `@normwerk/einvoice-medusa`'s own build target is `medusa plugin:build` (`.medusa/server`) — a full
 * Medusa-CLI build, unneeded here since `order-to-commerce-invoice-input.ts` and everything under
 * `tax-matrix/` are plain, framework-free TypeScript (no Medusa import at all). `jiti` (already an
 * `einvoice-medusa` devDependency, added at the root too) loads them straight from source instead.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const HERE = resolve(fileURLToPath(import.meta.url), "..");
const REPO_ROOT = resolve(HERE, "../..");
const MEDUSA_SRC = resolve(REPO_ROOT, "packages/einvoice-medusa/src");
const CLI = resolve(REPO_ROOT, "packages/einvoice-conformance/dist/cli.js");
const REPEATS = 3;

function validateOnce(xmlPath) {
  try {
    const stdout = execFileSync("node", [CLI, "validate", xmlPath], {
      encoding: "utf-8",
      stdio: "pipe",
    });
    return JSON.parse(stdout);
  } catch (error) {
    const stdout = error.stdout?.toString();
    if (stdout === undefined || stdout === "") {
      throw error;
    }
    return JSON.parse(stdout);
  }
}

async function main() {
  const jiti = createJiti(resolve(MEDUSA_SRC, "tax-matrix/run-cell.ts"));
  const { loadTaxMatrixCells } = await jiti.import(resolve(MEDUSA_SRC, "tax-matrix/load-cells.ts"));
  const { runTaxMatrixCell } = await jiti.import(resolve(MEDUSA_SRC, "tax-matrix/run-cell.ts"));

  const { serializeCii } = await import(resolve(REPO_ROOT, "packages/einvoice-cii/dist/index.js"));
  const { buildInvoice, selectProfile } = await import(
    resolve(REPO_ROOT, "packages/einvoice-commerce/dist/index.js")
  );

  const cells = loadTaxMatrixCells().filter((cell) => cell.expected.build.kind === "ok");
  if (cells.length === 0) {
    console.log(
      "No tax-matrix cells expect a validated build outcome — nothing to run against KoSIT.",
    );
    return;
  }

  const scratch = mkdtempSync(join(tmpdir(), "einvoice-tax-matrix-"));
  /** @type {Map<string, { xml: string, valid: boolean, accepted: boolean | undefined }[]>} */
  const runsByCell = new Map(cells.map((cell) => [cell.id, []]));

  for (let run = 1; run <= REPEATS; run++) {
    for (const cell of cells) {
      const result = runTaxMatrixCell(cell, { selectProfile, buildInvoice });
      if (result.build.kind !== "ok" || result.buildResult === undefined) {
        throw new Error(
          `cell "${cell.id}" expected a validated build outcome but got ${JSON.stringify(result.build)} on run ${run}`,
        );
      }
      const { xml } = serializeCii(result.buildResult.invoice, { profile: "en16931-cii" });
      const xmlPath = resolve(scratch, `${cell.id}-run${run}.xml`);
      writeFileSync(xmlPath, xml);
      const report = validateOnce(xmlPath);
      runsByCell.get(cell.id).push({ xml, valid: report.valid, accepted: report.accepted });
    }
  }

  let failed = 0;
  for (const cell of cells) {
    const runs = runsByCell.get(cell.id);
    const [first, ...rest] = runs;
    const deterministic = rest.every(
      (r) => r.xml === first.xml && r.valid === first.valid && r.accepted === first.accepted,
    );
    const kositGreen = first.valid === true;
    const ok = deterministic && kositGreen;
    console.log(
      `${ok ? "PASS" : "FAIL"}  ${cell.id}  (valid=${first.valid} accepted=${first.accepted} deterministic=${deterministic})`,
    );
    if (!ok) {
      failed++;
      if (!deterministic) {
        console.log(`  non-deterministic across ${REPEATS} runs`);
      }
      if (!kositGreen) {
        console.log(`  KoSIT: ${JSON.stringify(runs[0])}`);
      }
    }
  }

  console.log(
    `\n${cells.length - failed}/${cells.length} tax-matrix "validated" cells pass L1+L2 (KoSIT), ${REPEATS}x deterministic.`,
  );
  if (failed > 0) process.exitCode = 1;
}

main();
