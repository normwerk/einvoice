#!/usr/bin/env node
/**
 * T-043: L5 round-trip. Serializes every fixture to CII XML, then runs it
 * through Mustang (an independent Java implementation, not KoSIT) with its
 * default arithmetic recalculation check enabled — Mustang re-derives
 * totals from the line items and flags a mismatch, so a clean run here is
 * cross-implementation agreement on the numbers, not just "XML is
 * well-formed" (that part is already covered by L1/L2 via KoSIT).
 *
 * Requires: `pnpm --filter @normwerk/einvoice-cii build` and the Mustang
 * image built (`docker compose -f docker/compose.conformance.yml build mustang`).
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../..");
const FIXTURES_DIR = resolve(REPO_ROOT, "fixtures");
const MUSTANG_IMAGE = "einvoice-conformance-mustang:local";

function runMustangValidate(hostDir, fileName) {
  return execFileSync(
    "docker",
    [
      "run",
      "--rm",
      "-v",
      `${hostDir}:/data:ro`,
      MUSTANG_IMAGE,
      "--action",
      "validate",
      "--source",
      `/data/${fileName}`,
    ],
    { encoding: "utf-8", maxBuffer: 16 * 1024 * 1024 },
  );
}

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

  const scratch = mkdtempSync(join(tmpdir(), "einvoice-mustang-roundtrip-"));
  const results = [];
  for (const id of ids) {
    const invoice = JSON.parse(readFileSync(resolve(FIXTURES_DIR, id, "input.json"), "utf-8"));
    const { xml } = serializeCii(invoice, { profile: "en16931-cii" });
    const fileName = `${id}.xml`;
    writeFileSync(resolve(scratch, fileName), xml);

    const output = runMustangValidate(scratch, fileName);
    const statusMatch = /<summary status="([a-z]+)"\/>/.exec(output);
    const valid = statusMatch?.[1] === "valid";
    // grand total in our own model, for the report's "key BT" callout.
    results.push({ id, valid, totalAmountWithVat: invoice.totals.totalAmountWithVat, output });
  }

  const failed = results.filter((r) => !r.valid);
  for (const r of results) {
    console.log(`${r.valid ? "PASS" : "FAIL"}  ${r.id}  (BT-112 total: ${r.totalAmountWithVat})`);
    if (!r.valid) console.log(r.output);
  }
  console.log(
    `\n${results.length - failed.length}/${results.length} fixtures round-trip clean through Mustang (L5).`,
  );
  if (failed.length > 0) process.exitCode = 1;
}

main();
