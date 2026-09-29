#!/usr/bin/env node
/**
 * T-199: checks Germany's VAT rate table (`packages/einvoice-commerce/src/de-vat-rates.ts`) against the
 * UStG — every period's quotes word for word, with their rates and, for a temporary rate, its dates — in every
 * version the federal legal information portal lists. Fetches the text (or reads `--xml <file>`); not part of
 * the build, which stays offline. Prints the hashes `docs/sources.md` records for `tools/rates/watch-ustg.mjs`.
 *
 * Requires `pnpm --filter @normwerk/einvoice-commerce build`.
 */
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { checkQuotes, extractNorms, loadUstgExpressions, sha256 } from "./ustg.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

async function main() {
  const xmlArg = process.argv.indexOf("--xml");
  const { DE_VAT_RATE_PERIODS } = await import(
    resolve(REPO_ROOT, "packages/einvoice-commerce/dist/index.js")
  );
  const expressions = await loadUstgExpressions(
    xmlArg === -1 ? undefined : process.argv[xmlArg + 1],
  );
  const failures = [];
  for (const { eli, legalForce, xml } of expressions) {
    const norms = extractNorms(xml);
    console.log(`UStG ${eli}${legalForce ? ` (${legalForce})` : ""}`);
    for (const [paragraph, text] of norms)
      console.log(`  ${paragraph} text SHA-256 ${sha256(text)}`);
    failures.push(
      ...checkQuotes(DE_VAT_RATE_PERIODS, norms).map((failure) => `${eli}: ${failure}`),
    );
  }
  for (const period of DE_VAT_RATE_PERIODS) {
    console.log(
      `${period.from} … ${period.to ?? "open"}: ${period.standard} % / ${period.reduced} % — ` +
        `${period.quotes.length} quotes`,
    );
  }
  if (failures.length > 0) {
    for (const failure of failures) console.error(`FAIL  ${failure}`);
    process.exit(1);
  }
  console.log(
    `\nEvery quote of ${DE_VAT_RATE_PERIODS.length} periods found in every version of the UStG listed.`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
