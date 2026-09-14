#!/usr/bin/env node
/**
 * T-030 continuation: turns the vendored Liberation Sans TTFs
 * (artifacts/fonts/, see artifacts/MANIFEST.json for provenance/licence —
 * SIL OFL 1.1) into a generated TS module — same ADR-002 philosophy as the
 * ICC profile codegen (tools/codegen/pdfa/generate-icc-profile.mjs):
 * generate from a vendored artifact, don't hand-copy bytes, and sidestep
 * resolving a repo-root artifacts/ path from inside a package's built
 * dist/ output.
 *
 * Only Regular and Bold are vendored/generated — the real visual invoice
 * layout (render-invoice.ts) uses body text (Regular) and emphasis for
 * headers/totals (Bold); Italic/BoldItalic are not used anywhere and are
 * intentionally not vendored (AGENTS.md §5.1: no unused artifacts).
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../..");
const FONTS_DIR = resolve(REPO_ROOT, "artifacts/fonts");
const OUT_DIR = resolve(REPO_ROOT, "packages/einvoice-pdfa/src/generated");
const OUT_PATH = resolve(OUT_DIR, "liberation-sans-fonts.ts");

const FONTS = [
  {
    file: "LiberationSans-Regular.ttf",
    constName: "LIBERATION_SANS_REGULAR_BASE64",
    fn: "liberationSansRegularBytes",
  },
  {
    file: "LiberationSans-Bold.ttf",
    constName: "LIBERATION_SANS_BOLD_BASE64",
    fn: "liberationSansBoldBytes",
  },
];

const entries = FONTS.map(({ file, constName, fn }) => {
  const bytes = readFileSync(resolve(FONTS_DIR, file));
  const base64 = bytes.toString("base64");
  return { file, constName, fn, bytes, base64 };
});

const body = entries
  .map(
    ({ file, constName, fn, base64 }) => `/** ${file}, base64-encoded. */
export const ${constName} =
  "${base64}";

export function ${fn}(): Uint8Array {
  return Uint8Array.from(Buffer.from(${constName}, "base64"));
}
`,
  )
  .join("\n");

const out = `/**
 * GENERATED FILE — do not hand-edit (AGENTS.md §9).
 *
 * Generator: tools/codegen/pdfa/generate-fonts.mjs
 * Source artifacts: artifacts/fonts/LiberationSans-{Regular,Bold}.ttf (see
 *   artifacts/MANIFEST.json for provenance, sha256, and licence — SIL Open
 *   Font License 1.1, freely embeddable/redistributable).
 * To change: replace the vendored .ttf files, update their MANIFEST.json
 *   entries (new sha256 + fetched_at), then re-run \`pnpm codegen:pdfa\`
 *   from the repo root.
 */

${body}`;

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT_PATH, out);
for (const { file, bytes, base64 } of entries) {
  console.log(`Generated from ${file} (${bytes.length} bytes -> ${base64.length} base64 chars)`);
}
console.log(`-> ${OUT_PATH}`);
