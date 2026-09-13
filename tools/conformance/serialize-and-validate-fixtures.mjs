#!/usr/bin/env node
/**
 * T-021/T-040: serializes every fixture in fixtures/ to CII XML and runs
 * each through the real KoSIT validator (via this package's own CLI —
 * same code path `pnpm conformance validate` uses). Exits non-zero if any
 * fixture is rejected, so this is usable both locally and as a CI gate
 * (plan-v0.1 §4.5/§9's "locally and in CI identically" requirement).
 *
 * Requires: `pnpm --filter @normwerk/einvoice-cii build` and the KoSIT
 * image built (`docker compose -f docker/compose.conformance.yml build kosit`).
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../..");
const FIXTURES_DIR = resolve(REPO_ROOT, "fixtures");
const CLI = resolve(REPO_ROOT, "packages/einvoice-conformance/dist/cli.js");

async function main() {
  const { serializeCii } = await import(resolve(REPO_ROOT, "packages/einvoice-cii/dist/index.js"));

  const ids = readdirSync(FIXTURES_DIR).filter((name) => {
    try {
      readFileSync(resolve(FIXTURES_DIR, name, "input.json"));
      return true;
    } catch {
      return false;
    }
  });

  const scratch = mkdtempSync(join(tmpdir(), "einvoice-cii-fixtures-"));
  const results = [];
  for (const id of ids) {
    const invoice = JSON.parse(readFileSync(resolve(FIXTURES_DIR, id, "input.json"), "utf-8"));
    const { xml } = serializeCii(invoice, { profile: "en16931-cii" });
    const xmlPath = resolve(scratch, `${id}.xml`);
    writeFileSync(xmlPath, xml);

    try {
      execFileSync("node", [CLI, "validate", xmlPath], { encoding: "utf-8", stdio: "pipe" });
      results.push({ id, valid: true });
    } catch (error) {
      const stdout = error.stdout?.toString() ?? "";
      results.push({ id, valid: false, output: stdout });
    }
  }

  const failed = results.filter((r) => !r.valid);
  for (const r of results) {
    console.log(`${r.valid ? "PASS" : "FAIL"}  ${r.id}`);
    if (!r.valid) console.log(r.output);
  }
  console.log(`\n${results.length - failed.length}/${results.length} fixtures pass L1+L2 (KoSIT).`);
  if (failed.length > 0) process.exitCode = 1;
}

main();
