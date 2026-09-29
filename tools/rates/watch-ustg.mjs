#!/usr/bin/env node
/**
 * T-200 (P-73): watches the consolidated UStG for a change to § 12 or § 28 — the paragraphs Germany's VAT rates
 * live in. The rate table ships with the package (`de-vat-rates.ts`), so a new rate reaches a shop only through
 * a release, and that release has to be out before the rate applies (in 2020, less than a month after it was
 * announced). Run weekly by `.github/workflows/ustg-watch.yml`.
 *
 * Compares each paragraph's text hash with the one `docs/sources.md` records. Unchanged: prints one line and
 * exits 0. Changed: opens an issue in this repository — unless an open one already names the same new hashes —
 * saying which paragraph changed, which quotes of the rate table no longer hold, and the paragraph's new text.
 * The old text is not kept (not vendored, `docs/sources.md`), so the issue shows the new one. Never fails the
 * build or a release; a fetch error fails only this job.
 *
 *   node tools/rates/watch-ustg.mjs [--xml <file>] [--sources <file>] [--gh <command>] [--dry-run]
 *
 * `--xml` reads a file instead of fetching, `--sources` reads the recorded hashes from another file than
 * `docs/sources.md`, `--gh` names the GitHub CLI to call — the last two are for tests. `--dry-run` prints the
 * issue instead of opening it. Requires `pnpm --filter @normwerk/einvoice-commerce build`.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { RATE_NORMS, buildDate, checkQuotes, extractNorms, loadUstgXml, sha256 } from "./ustg.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function argument(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

/** The text hashes `docs/sources.md` records, keyed by paragraph: "`§ 12` text SHA-256: `…`". */
export function recordedHashes(sourcesMd) {
  const hashes = new Map();
  for (const match of sourcesMd.matchAll(/`(§ \d+)` text SHA-256: `([0-9a-f]{64})`/g)) {
    hashes.set(match[1], match[2]);
  }
  return hashes;
}

async function main() {
  const gh = argument("--gh") ?? "gh";
  const dryRun = process.argv.includes("--dry-run");
  const sourcesPath = argument("--sources") ?? resolve(REPO_ROOT, "docs/sources.md");
  const recorded = recordedHashes(readFileSync(sourcesPath, "utf-8"));
  for (const paragraph of RATE_NORMS) {
    if (!recorded.has(paragraph))
      throw new Error(`${sourcesPath} records no hash for ${paragraph}`);
  }
  const { xml } = await loadUstgXml(argument("--xml"));
  const norms = extractNorms(xml);
  const changed = RATE_NORMS.filter(
    (paragraph) =>
      !norms.has(paragraph) || sha256(norms.get(paragraph)) !== recorded.get(paragraph),
  );
  if (changed.length === 0) {
    console.log(`UStG ${RATE_NORMS.join(" and ")} unchanged (built ${buildDate(xml) ?? "?"}).`);
    return;
  }

  const { DE_VAT_RATE_PERIODS } = await import(
    resolve(REPO_ROOT, "packages/einvoice-commerce/dist/index.js")
  );
  const failures = checkQuotes(DE_VAT_RATE_PERIODS, norms);
  const newHashes = changed.map((paragraph) =>
    norms.has(paragraph) ? sha256(norms.get(paragraph)).slice(0, 12) : "gone",
  );
  const title = `UStG ${changed.join(" and ")} changed (${newHashes.join(", ")}) — check Germany's VAT rate table`;
  const body = [
    `The consolidated UStG at gesetze-im-internet.de (built ${buildDate(xml) ?? "?"}) no longer matches the text ` +
      "this repository's VAT rate table was checked against (`docs/sources.md`). A new rate reaches shops only " +
      "through a release, which has to be out before the rate applies.",
    "",
    ...changed.map(
      (paragraph) =>
        `- ${paragraph}: recorded \`${recorded.get(paragraph)}\`, now ` +
        (norms.has(paragraph) ? `\`${sha256(norms.get(paragraph))}\`` : "not in the XML"),
    ),
    "",
    failures.length === 0
      ? "Every quote of the rate table (`packages/einvoice-commerce/src/de-vat-rates.ts`) still holds — the change may be elsewhere in the paragraph."
      : ["Quotes of the rate table that no longer hold:", ...failures.map((f) => `- ${f}`)].join(
          "\n",
        ),
    "",
    "What to do: read the change, update `de-vat-rates.ts` and `docs/sources.md` (`node tools/rates/verify-de-vat-rates.mjs` prints the new hashes), release.",
    "",
    ...changed.flatMap((paragraph) =>
      norms.has(paragraph)
        ? [
            `<details><summary>${paragraph} as it reads now</summary>`,
            "",
            norms.get(paragraph),
            "",
            "</details>",
          ]
        : [],
    ),
  ].join("\n");

  if (dryRun) {
    console.log(`${title}\n\n${body}`);
    return;
  }
  const open = JSON.parse(
    execFileSync(
      gh,
      ["issue", "list", "--state", "open", "--search", `${title} in:title`, "--json", "title"],
      {
        encoding: "utf-8",
      },
    ),
  );
  if (open.some((issue) => issue.title === title)) {
    console.log(`Already open: ${title}`);
    return;
  }
  const bodyFile = join(mkdtempSync(join(tmpdir(), "ustg-watch-")), "body.md");
  writeFileSync(bodyFile, body);
  execFileSync(gh, ["issue", "create", "--title", title, "--body-file", bodyFile], {
    stdio: "inherit",
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
