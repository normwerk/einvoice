#!/usr/bin/env node
/**
 * T-032/T-030: turns the vendored sRGB ICC profile (artifacts/pdfa/sRGB2014.icc,
 * see artifacts/MANIFEST.json for provenance/licence) into a generated TS
 * module — same ADR-002 philosophy as einvoice-model's codegen (generate from
 * a vendored artifact, don't hand-copy bytes), and sidesteps the runtime
 * fragility of resolving a repo-root artifacts/ path from inside a package's
 * built dist/ output.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../..");
const ICC_PATH = resolve(REPO_ROOT, "artifacts/pdfa/sRGB2014.icc");
const OUT_DIR = resolve(REPO_ROOT, "packages/einvoice-pdfa/src/generated");
const OUT_PATH = resolve(OUT_DIR, "srgb-icc-profile.ts");

const bytes = readFileSync(ICC_PATH);
const base64 = bytes.toString("base64");

const out = `/**
 * GENERATED FILE — do not hand-edit (AGENTS.md §9).
 *
 * Generator: tools/codegen/pdfa/generate-icc-profile.mjs
 * Source artifact: artifacts/pdfa/sRGB2014.icc (see artifacts/MANIFEST.json
 *   for provenance, sha256, and licence — ICC's own license, copy/distribute/
 *   embed/use/sell without restriction).
 * To change: replace the vendored .icc file, update its MANIFEST.json entry
 * (new sha256 + fetched_at), then re-run \`pnpm codegen:pdfa\` from the repo root.
 */

/** sRGB2014.icc, base64-encoded. ICC v2 profile, 2015 revision. */
export const SRGB_ICC_PROFILE_BASE64 =
  "${base64}";

export function srgbIccProfileBytes(): Uint8Array {
  return Uint8Array.from(Buffer.from(SRGB_ICC_PROFILE_BASE64, "base64"));
}
`;

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT_PATH, out);
console.log(`Generated ${OUT_PATH} (${bytes.length} bytes -> ${base64.length} base64 chars)`);
