#!/usr/bin/env node
/**
 * T-043: L5 round-trip (AGENTS.md §8: "our XML parsed by Mustang; totals and key BTs compared back to the
 * model"). Serializes every fixture to CII XML, then hands it to Mustang — an independent Java
 * implementation, not KoSIT — twice:
 *
 * 1. `--action validate`, with its arithmetic recalculation check: Mustang re-derives the totals from the
 *    lines and flags a mismatch.
 * 2. `--action ubl`: Mustang parses the CII into its own model and writes that out as UBL. The totals, the
 *    VAT breakdown and each line's quantity and net amount in it are compared with the model the fixture
 *    was serialized from (`roundtrip-mustang/compare-ubl.mjs`). Until P-53 this step did not exist: the
 *    totals were printed, never compared, and L5 checked only that Mustang called the XML valid.
 *
 * Requires: `pnpm --filter @normwerk/einvoice-cii build` and the Mustang
 * image built (`docker compose -f docker/compose.conformance.yml build mustang`).
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { compareUblToModel } from "./roundtrip-mustang/compare-ubl.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../..");
const FIXTURES_DIR = resolve(REPO_ROOT, "fixtures");
const MUSTANG_IMAGE = "einvoice-conformance-mustang:local";

/** Mustang's own reading of our CII, written out as UBL. */
function runMustangToUbl(hostDir, fileName) {
  const outName = fileName.replace(/\.xml$/, ".ubl.xml");
  execFileSync(
    "docker",
    [
      "run",
      "--rm",
      "-v",
      `${hostDir}:/data`,
      MUSTANG_IMAGE,
      "--action",
      "ubl",
      "--source",
      `/data/${fileName}`,
      "--out",
      `/data/${outName}`,
    ],
    { encoding: "utf-8", maxBuffer: 16 * 1024 * 1024 },
  );
  return readFileSync(resolve(hostDir, outName), "utf-8");
}

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
    const checks = compareUblToModel(runMustangToUbl(scratch, fileName), invoice);
    const mismatches = checks.filter((check) => !check.ok);
    results.push({
      id,
      valid,
      checks,
      mismatches,
      output,
      passed: valid && mismatches.length === 0,
    });
  }

  const failed = results.filter((r) => !r.passed);
  for (const r of results) {
    console.log(
      `${r.passed ? "PASS" : "FAIL"}  ${r.id}  (Mustang: ${r.valid ? "valid" : "INVALID"}; ` +
        `${r.checks.length - r.mismatches.length}/${r.checks.length} terms read back as written)`,
    );
    for (const m of r.mismatches) {
      console.log(`      ${m.term}: model ${m.expected}, Mustang read ${m.actual ?? "nothing"}`);
    }
    if (!r.valid) console.log(r.output);
  }
  console.log(
    `\n${results.length - failed.length}/${results.length} fixtures round-trip clean through Mustang (L5): ` +
      "valid, and every compared term read back as written.",
  );
  if (failed.length > 0) process.exitCode = 1;
}

main();
