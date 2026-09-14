#!/usr/bin/env node
/**
 * T-041: L4 differential oracle #1 — generates every fixture's CII XML
 * through our own serializer and, independently, through @e-invoice-eu/core
 * (a real third-party WTFPL library, devDependency only — never imported by
 * any published package, M-005/D-17), canonicalizes both, and reports every
 * path where they disagree.
 *
 * This script does NOT auto-classify differences as "our bug" / "their bug"
 * / "permissible variation" — AGENTS.md §8 rule 2 requires that judgment to
 * be made and recorded by a person, not inferred mechanically. It emits the
 * raw structured diff for each fixture to `docs/l4-oracle-eu-report.md`
 * alongside a hand-written classification for each fixture that already
 * ran once (see that file's history) — classification of any new
 * difference must be added by hand, not left as "unclassified" in a
 * committed report.
 *
 * Requires: `pnpm --filter @normwerk/einvoice-cii build`.
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mapInvoiceToUbl } from "./oracle-e-invoice-eu/map-to-ubl.mjs";
import { canonicalize, diffCanonical } from "./oracle-e-invoice-eu/canonicalize.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../..");
const FIXTURES_DIR = resolve(REPO_ROOT, "fixtures");
const REPORT_PATH = resolve(REPO_ROOT, "docs/l4-oracle-eu-report.md");

const require = createRequire(import.meta.url);

// A silent logger: InvoiceService logs at "info" for every render step, which
// is noise for a batch run — real errors still throw and are caught below.
function noop() {
  /* silent */
}
const SILENT_LOGGER = { log: noop, warn: noop, error: noop, debug: noop };

function listFixtureIds() {
  return readdirSync(FIXTURES_DIR)
    .filter((name) => {
      try {
        readFileSync(resolve(FIXTURES_DIR, name, "input.json"));
        return true;
      } catch {
        return false;
      }
    })
    .sort();
}

/**
 * Hand-written classifications (AGENTS.md §8 rule 2) for diff *shapes* that
 * have already been investigated. Returns the classification text for a
 * known shape, or `null` for anything unrecognized (which the report then
 * marks as an unreviewed TODO) — a script must never auto-classify a
 * genuinely new difference, only recognize ones a person already looked at.
 */
function classifyKnownDiff(diff) {
  const onlyEmptyDelivery =
    diff.onlyInOurs.length === 1 &&
    diff.onlyInOurs[0].path.endsWith("}ApplicableHeaderTradeDelivery[0]") &&
    diff.onlyInOurs[0].value === "" &&
    diff.onlyInTheirs.length === 0 &&
    diff.differing.length === 0;
  if (onlyEmptyDelivery) {
    return (
      "**Ours is correct; theirs has a real bug — verified by running the real KoSIT validator, not just reading " +
      "the XSD.** `ApplicableHeaderTradeDelivery` carries no `minOccurs` in `SupplyChainTradeTransactionType` " +
      "(`artifacts/cii-d16b/schema/CrossIndustryInvoice_ReusableAggregateBusinessInformationEntity_100pD16B.xsd:905`), " +
      'so the XSD default `minOccurs="1"` applies: the element is required even when empty. Our serializer always ' +
      "emits the empty `<ram:ApplicableHeaderTradeDelivery/>` container for fixtures with no `delivery` field; " +
      "`@e-invoice-eu/core` omits it entirely instead. Confirmed independently: running `@e-invoice-eu/core`'s own " +
      "CII output for `de-b2b-standard` through the real KoSIT validator fails L1 XSD with `cvc-complex-type.2.4.a` " +
      "(\"Invalid content ... One of '{...}ApplicableHeaderTradeDelivery' is expected\") — their CII binding produces " +
      "XSD-invalid output for any invoice with no delivery information. Not a permissible variation: a real bug in " +
      "their tool. Our own output is unaffected — all 13 fixtures still pass the real KoSIT validator " +
      "(`pnpm conformance:fixtures`)."
    );
  }
  return null;
}

function formatDiffSection(title, entries, valueLabel) {
  if (entries.length === 0) return `- ${title}: none\n`;
  const lines = entries
    .slice(0, 50)
    .map((e) =>
      valueLabel
        ? `  - \`${e.path}\`\n    - ours: \`${e.ours}\`\n    - theirs: \`${e.theirs}\``
        : `  - \`${e.path}\` = \`${e.value}\``,
    );
  const more = entries.length > 50 ? `\n  - … and ${entries.length - 50} more` : "";
  return `- ${title} (${entries.length}):\n${lines.join("\n")}${more}\n`;
}

async function main() {
  const { serializeCii } = await import(resolve(REPO_ROOT, "packages/einvoice-cii/dist/index.js"));
  const { InvoiceService } = require("@e-invoice-eu/core");
  const oracleService = new InvoiceService(SILENT_LOGGER);

  const ids = listFixtureIds();
  const results = [];

  for (const id of ids) {
    const invoice = JSON.parse(readFileSync(resolve(FIXTURES_DIR, id, "input.json"), "utf-8"));
    const { xml: ourXml } = serializeCii(invoice, { profile: "en16931-cii" });

    let entry = { id };
    try {
      const ubl = mapInvoiceToUbl(invoice);
      const oracleXml = await oracleService.generate(ubl, { format: "CII", lang: "en-us" });
      const oracleXmlText =
        typeof oracleXml === "string" ? oracleXml : Buffer.from(oracleXml).toString("utf-8");
      const diff = diffCanonical(canonicalize(ourXml), canonicalize(oracleXmlText));
      entry = {
        ...entry,
        status: "compared",
        diff,
        clean:
          diff.onlyInOurs.length === 0 &&
          diff.onlyInTheirs.length === 0 &&
          diff.differing.length === 0,
      };
    } catch (err) {
      entry = {
        ...entry,
        status: "error",
        error: err instanceof Error ? err.message : String(err),
      };
    }
    results.push(entry);
  }

  const compared = results.filter((r) => r.status === "compared");
  const clean = compared.filter((r) => r.clean);
  const errored = results.filter((r) => r.status === "error");
  const unreviewed = compared.filter((r) => !r.clean && classifyKnownDiff(r.diff) === null);

  for (const r of results) {
    if (r.status === "error") console.log(`ERROR  ${r.id}  ${r.error}`);
    else if (r.clean) console.log(`CLEAN  ${r.id}`);
    else console.log(`${classifyKnownDiff(r.diff) ? "KNOWN" : "DIFF "}  ${r.id}`);
  }
  console.log(
    `\n${clean.length}/${results.length} byte-for-byte-equivalent (after canonicalization); ` +
      `${compared.length - clean.length - unreviewed.length} differ but have a recorded classification; ` +
      `${unreviewed.length} unreviewed diffs; ${errored.length} could not be mapped/generated.`,
  );
  if (unreviewed.length > 0) {
    console.log(
      `\n${unreviewed.length} fixture(s) have a diff shape with no recorded classification — see ` +
        `docs/l4-oracle-eu-report.md and add a case to classifyKnownDiff() once reviewed.`,
    );
  }

  // No timestamp: CI re-runs this and diffs the result against the
  // committed report (git already records when it last actually changed —
  // matching the same determinism principle as codegen:model's CI check).
  let md = `# L4 differential oracle report — @e-invoice-eu/core\n\n`;
  md += `Generated by \`tools/conformance/oracle-e-invoice-eu.mjs\` (T-041). Re-run with \`pnpm conformance:oracle-eu\`.\n\n`;
  md += `Method: for every fixture, serialize with \`@normwerk/einvoice-cii\` (ours) and, independently, `;
  md += `map the same \`Invoice\` model into \`@e-invoice-eu/core\`'s UBL-JSON input and render CII through it `;
  md += `(theirs). Both outputs are canonicalized (see \`tools/conformance/oracle-e-invoice-eu/canonicalize.mjs\` — `;
  md += `a pragmatic prefix/attribute-order/whitespace-insensitive form, not full W3C XML C14N) and diffed path-by-path. `;
  md += `\`@e-invoice-eu/core\` is WTFPL, used as a devDependency only — never imported by any published package `;
  md += `(M-005/D-17).\n\n`;
  md += `**Summary: ${clean.length}/${results.length} clean, ${compared.length - clean.length - unreviewed.length} differ with a recorded classification, ${unreviewed.length} unreviewed, ${errored.length} errored.**\n\n`;

  for (const r of results) {
    md += `## \`${r.id}\`\n\n`;
    if (r.status === "error") {
      md += `**Could not compare** — ${r.error}\n\n`;
      continue;
    }
    if (r.clean) {
      md += `Clean — canonicalized CII agrees on every path.\n\n`;
      continue;
    }
    const known = classifyKnownDiff(r.diff);
    md += `Classification: ${known ?? "_TODO — not yet classified by a human reviewer (AGENTS.md §8 rule 2)._"}\n\n`;
    md += formatDiffSection("Only in ours", r.diff.onlyInOurs, false);
    md += formatDiffSection("Only in theirs", r.diff.onlyInTheirs, false);
    md += formatDiffSection("Differing values", r.diff.differing, true);
    md += "\n";
  }

  writeFileSync(REPORT_PATH, md);
  console.log(`\nWrote ${REPORT_PATH}`);

  // CI gate: a *new* diff shape (one classifyKnownDiff doesn't recognize) or
  // a mapping/generation error must fail the build and be looked at by a
  // person — but the 11 fixtures with an already-recorded classification are
  // expected steady-state, not a failure.
  if (unreviewed.length > 0 || errored.length > 0) process.exitCode = 1;
}

main();
