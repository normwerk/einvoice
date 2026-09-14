#!/usr/bin/env node
/**
 * T-060/T-061/T-064/W9: proves the whole `CommerceInvoiceInput` → `buildInvoice`
 * → `serializeCii` → real KoSIT pipeline end to end, for real (AGENTS.md
 * §8: never simulate conformance) — not just that `buildInvoice`'s unit
 * tests pass in isolation.
 *
 * Reads every fixture under `packages/einvoice-commerce/fixtures/`
 * (`input.json`, a `CommerceInvoiceInput` — distinct from the root
 * `fixtures/` directory, which is strictly `Invoice`-model-shaped,
 * `fixtures/README.md`), builds it, serializes it, and validates it via
 * the same CLI path `pnpm conformance validate` and
 * `tools/conformance/serialize-and-validate-fixtures.mjs` already use.
 *
 * Requires: `pnpm --filter @normwerk/einvoice-model build`,
 * `pnpm --filter @normwerk/einvoice-cii build`,
 * `pnpm --filter @normwerk/einvoice-commerce build`, and the KoSIT image
 * built (`docker compose -f docker/compose.conformance.yml build kosit`).
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../..");
const FIXTURES_DIR = resolve(REPO_ROOT, "packages/einvoice-commerce/fixtures");
const CLI = resolve(REPO_ROOT, "packages/einvoice-conformance/dist/cli.js");

async function main() {
  const { serializeCii } = await import(resolve(REPO_ROOT, "packages/einvoice-cii/dist/index.js"));
  const { buildInvoice } = await import(
    resolve(REPO_ROOT, "packages/einvoice-commerce/dist/index.js")
  );

  const ids = readdirSync(FIXTURES_DIR).filter((name) =>
    existsSync(resolve(FIXTURES_DIR, name, "input.json")),
  );

  const scratch = mkdtempSync(join(tmpdir(), "einvoice-commerce-fixtures-"));
  const results = [];
  for (const id of ids) {
    const input = JSON.parse(readFileSync(resolve(FIXTURES_DIR, id, "input.json"), "utf-8"));
    const evidencePath = resolve(FIXTURES_DIR, id, "vat-id-evidence.json");
    const vatIdEvidence = existsSync(evidencePath)
      ? JSON.parse(readFileSync(evidencePath, "utf-8"))
      : undefined;

    let buildResult;
    try {
      buildResult = buildInvoice(input, { vatIdEvidence });
    } catch (error) {
      results.push({
        id,
        valid: false,
        output: `buildInvoice threw: ${error.stack ?? error.message}`,
      });
      continue;
    }

    const { xml } = serializeCii(buildResult.invoice, { profile: "en16931-cii" });
    const xmlPath = resolve(scratch, `${id}.xml`);
    writeFileSync(xmlPath, xml);

    try {
      execFileSync("node", [CLI, "validate", xmlPath], { encoding: "utf-8", stdio: "pipe" });
      results.push({
        id,
        valid: true,
        decisions: buildResult.decisions,
        warnings: buildResult.warnings,
      });
    } catch (error) {
      const stdout = error.stdout?.toString() ?? "";
      results.push({ id, valid: false, output: stdout });
    }
  }

  const failed = results.filter((r) => !r.valid);
  for (const r of results) {
    console.log(`${r.valid ? "PASS" : "FAIL"}  ${r.id}`);
    if (r.valid) {
      for (const d of r.decisions)
        console.log(`  decision: ${d.ruleId} -> ${d.categoryCode} (${d.reasoning})`);
      for (const w of r.warnings) console.log(`  warning: ${w.code} — ${w.message}`);
    } else {
      console.log(r.output);
    }
  }
  console.log(
    `\n${results.length - failed.length}/${results.length} commerce fixtures pass L1+L2 (KoSIT).`,
  );
  if (failed.length > 0) process.exitCode = 1;
}

main();
