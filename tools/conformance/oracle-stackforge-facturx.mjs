#!/usr/bin/env node
/**
 * T-042: L4 differential oracle #2 — generates every fixture's CII XML
 * through our own serializer and, independently, through
 * @stackforge-eu/factur-x's toXRechnung() (a real third-party EUPL-1.2
 * library, devDependency only — never imported by any published package,
 * M-005/D-17), canonicalizes both, and reports every path where they
 * disagree. Same structure and discipline as oracle-e-invoice-eu.mjs
 * (T-041) — see that file's header for the reasoning this one shares.
 *
 * A fixture whose invoice uses a construct the library's input type has no
 * field for (see map-to-facturx-input.mjs) is reported as "unmappable", not
 * silently skipped or force-fit — currently just `de-line-discount`
 * (line-level allowance, BG-27).
 *
 * Requires: `pnpm --filter @normwerk/einvoice-cii build`.
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { toXRechnung } from "@stackforge-eu/factur-x";
import { mapInvoiceToFacturXInput } from "./oracle-stackforge-facturx/map-to-facturx-input.mjs";
import { canonicalize, diffCanonical } from "./oracle-e-invoice-eu/canonicalize.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../..");
const FIXTURES_DIR = resolve(REPO_ROOT, "fixtures");
const REPORT_PATH = resolve(REPO_ROOT, "docs/l4-oracle-facturx-report.md");

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
 * Hand-written classifications (AGENTS.md §8 rule 2) for diff *shapes*
 * already investigated. `null` for anything unrecognized (marked as an
 * unreviewed TODO in the report) — never auto-classify a genuinely new
 * difference, only recognize ones a person already looked at.
 */
function isEmptyAddressTextField(e) {
  // LineOne (street, BT-35/50/64-ish) and CityName (BT-37/52 or the tax
  // representative's city, which einvoice-model doesn't model at all,
  // T-093) — same root cause, same PEPPOL-EN16931-R008 failure, confirmed
  // for both independently (see LINE_ONE_BUG below). PostalZone/postalCode
  // behaves differently: an empty string there is dropped by the library
  // entirely rather than rendered as an empty element, so it never shows
  // up as a diff — not something this needs to recognize.
  return (e.path.endsWith("}LineOne[0]") || e.path.endsWith("}CityName[0]")) && e.value === "";
}
function isDeliveryDateSynthesis(e) {
  return (
    e.path.includes("}ActualDeliverySupplyChainEvent[0]/") &&
    e.path.includes("}OccurrenceDateTime[0]")
  );
}
function isOurEmptyDeliveryContainer(e) {
  return e.path.endsWith("}ApplicableHeaderTradeDelivery[0]") && e.value === "";
}

const LINE_ONE_BUG =
  "**Real, verified bug in `@stackforge-eu/factur-x` — confirmed by an actual KoSIT run, not by reading a " +
  "spec — triggered here by a gap in `einvoice-model`.** The model has no street, city or post code for the " +
  "seller's tax representative (BG-11 carries its name, VAT-ID and country only), and the mapper cannot " +
  'invent them, so it passes empty strings (`address.line1: ""`, `city: ""`, see ' +
  "map-to-facturx-input.mjs). With `validate: false`, `toXRechnung()` renders those as literal empty " +
  "`<ram:LineOne></ram:LineOne>` / `<ram:CityName></ram:CityName>` elements — and that failure mode is " +
  "invisible to the library's own default validation too: calling `toXRechnung()` with `validate: true` (its " +
  "default) on this exact input does NOT flag either empty field as an error. KoSIT rejects the document with " +
  '`PEPPOL-EN16931-R008` ("Document MUST not contain empty elements"), one error per empty element; the same ' +
  "document with a real street and city passes. Until the model had address lines for the seller and buyer, " +
  "every fixture showed this for their street too; since then only the tax representative does (re-run " +
  "2026-09-23: every other fixture's generated document passes KoSIT). Not a flaw in our own CII output: our " +
  "serializer never emits `LineOne`/`CityName` when the underlying field is absent, which is schema-legal " +
  "(both elements are optional).";

const DELIVERY_DATE_VARIATION =
  "**Permissible variation, not a bug on either side — confirmed with a real KoSIT run, not assumed.** When the " +
  "invoice has no `delivery.actualDeliveryDate` (BT-72), `@stackforge-eu/factur-x` synthesizes " +
  "`ActualDeliverySupplyChainEvent/OccurrenceDateTime` defaulting to the invoice's issue date; we deliberately " +
  "emit nothing beyond the XSD-required empty `ApplicableHeaderTradeDelivery` container (see " +
  "`docs/l4-oracle-eu-report.md` for why that container itself is required even when empty), since BT-72 " +
  "genuinely wasn't given and inventing a delivery date would be fabricating data. The defaulting itself does " +
  "not break KoSIT: their generated document for each fixture whose only difference is this one passes KoSIT " +
  "(re-run 2026-09-23). BT-72 is optional and EN 16931 doesn't say what to do in its absence; \"leave it " +
  'unstated" (ours) and "assume the issue date" (theirs) are both legitimate readings.';

/**
 * Hand-written classifications (AGENTS.md §8 rule 2) for diff *shapes*
 * already investigated, both confirmed by running the actual generated XML
 * through the real KoSIT validator (not inferred from reading the XSD) and
 * by isolating each cause independently — see D-22 in HOW-WE-GOT-HERE.md.
 * `null` for anything unrecognized (marked as an unreviewed TODO in the
 * report) — never auto-classify a genuinely new difference, only recognize
 * ones a person already looked at.
 */
function classifyKnownDiff(diff) {
  if (diff.differing.length > 0) return null;
  const theirsExplained = diff.onlyInTheirs.every(
    (e) => isEmptyAddressTextField(e) || isDeliveryDateSynthesis(e),
  );
  const oursExplained =
    diff.onlyInOurs.length === 0 ||
    (diff.onlyInOurs.length === 1 && isOurEmptyDeliveryContainer(diff.onlyInOurs[0]));
  const hasEmptyAddressField = diff.onlyInTheirs.some(isEmptyAddressTextField);
  const hasDeliverySynth = diff.onlyInTheirs.some(isDeliveryDateSynthesis);
  // The empty container on our side and the synthesized delivery date on
  // theirs are the same underlying case ("no delivery given at all") —
  // require them to appear together, not independently, so this doesn't
  // over-match a differently-shaped diff.
  const deliveryCaseConsistent = (diff.onlyInOurs.length === 1) === hasDeliverySynth;
  if (!theirsExplained || !oursExplained || !deliveryCaseConsistent) return null;
  if (hasEmptyAddressField && hasDeliverySynth)
    return `${LINE_ONE_BUG}\n\n${DELIVERY_DATE_VARIATION}`;
  if (hasEmptyAddressField) return LINE_ONE_BUG;
  if (hasDeliverySynth) return DELIVERY_DATE_VARIATION;
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

  const ids = listFixtureIds();
  const results = [];

  for (const id of ids) {
    const invoice = JSON.parse(readFileSync(resolve(FIXTURES_DIR, id, "input.json"), "utf-8"));
    const { xml: ourXml } = serializeCii(invoice, { profile: "en16931-cii" });

    let entry = { id };
    try {
      const input = mapInvoiceToFacturXInput(invoice);
      const { xml: theirXml } = toXRechnung(input, { validate: false });
      const diff = diffCanonical(canonicalize(ourXml), canonicalize(theirXml));
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
        status: "unmappable",
        error: err instanceof Error ? err.message : String(err),
      };
    }
    results.push(entry);
  }

  const compared = results.filter((r) => r.status === "compared");
  const clean = compared.filter((r) => r.clean);
  const unmappable = results.filter((r) => r.status === "unmappable");
  const unreviewed = compared.filter((r) => !r.clean && classifyKnownDiff(r.diff) === null);

  for (const r of results) {
    if (r.status === "unmappable") console.log(`SKIP   ${r.id}  (${r.error})`);
    else if (r.clean) console.log(`CLEAN  ${r.id}`);
    else console.log(`${classifyKnownDiff(r.diff) ? "KNOWN" : "DIFF "}  ${r.id}`);
  }
  console.log(
    `\n${clean.length}/${results.length} byte-for-byte-equivalent (after canonicalization); ` +
      `${compared.length - clean.length - unreviewed.length} differ but have a recorded classification; ` +
      `${unreviewed.length} unreviewed diffs; ${unmappable.length} unmappable (no equivalent input field).`,
  );
  if (unreviewed.length > 0) {
    console.log(
      `\n${unreviewed.length} fixture(s) have a diff shape with no recorded classification — see ` +
        `docs/l4-oracle-facturx-report.md and add a case to classifyKnownDiff() once reviewed.`,
    );
  }

  let md = `# L4 differential oracle report — @stackforge-eu/factur-x\n\n`;
  md += `Generated by \`tools/conformance/oracle-stackforge-facturx.mjs\` (T-042). Re-run with \`pnpm conformance:oracle-facturx\`.\n\n`;
  md += `Method: for every fixture, serialize with \`@normwerk/einvoice-cii\` (ours) and, independently, `;
  md += `map the same \`Invoice\` model into \`@stackforge-eu/factur-x\`'s \`FacturXInvoiceInput\` and render `;
  md += `through its \`toXRechnung()\` (theirs). Both outputs are canonicalized (see `;
  md += `\`tools/conformance/oracle-e-invoice-eu/canonicalize.mjs\` — shared with the T-041 oracle, a pragmatic `;
  md += `prefix/attribute-order/whitespace-insensitive form, not full W3C XML C14N) and diffed path-by-path. `;
  md += `\`@stackforge-eu/factur-x\` is EUPL-1.2, used as a devDependency only — never imported by any published `;
  md += `package (M-005/D-17).\n\n`;
  md += `**Summary: ${clean.length}/${results.length} clean, ${compared.length - clean.length - unreviewed.length} differ with a recorded classification, ${unreviewed.length} unreviewed, ${unmappable.length} unmappable.**\n\n`;

  for (const r of results) {
    md += `## \`${r.id}\`\n\n`;
    if (r.status === "unmappable") {
      md += `**Unmappable** — this fixture uses a construct \`FacturXInvoiceInput\` has no field for: ${r.error}\n\n`;
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

  // CI gate: a genuinely new diff shape must fail the build and be looked
  // at by a person. `unmappable` fixtures are expected steady-state (a real,
  // already-documented library limitation), not a failure.
  if (unreviewed.length > 0) process.exitCode = 1;
}

main();
