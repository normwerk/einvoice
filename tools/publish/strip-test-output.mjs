#!/usr/bin/env node
/**
 * T-076: deletes compiled test output (`*.test.js`/`*.test.js.map`/`*.test.d.ts`/`*.test.d.ts.map`) from a
 * build output directory before packing/publishing. `tsconfig.json`'s own `include: ["src"]` (or, for
 * `einvoice-medusa`, `medusa plugin:build`'s own fixed build) has no test/non-test distinction, so every
 * package's build output includes its own compiled `*.test.ts` files alongside real source — real,
 * confirmed by a `npm pack --dry-run`/`pnpm pack` on each package, not assumed.
 *
 * A `files` array negation pattern (`"!dist/**\/*.test.js"`) works for `npm pack`/`npm publish` and for
 * `pnpm pack` on a `dist/`-shaped package — confirmed empirically on all four `tsc`-built packages — but
 * NOT for `pnpm pack` on `einvoice-medusa`'s `.medusa/server/` output (a real, empirically confirmed
 * inconsistency between `npm`'s and `pnpm`'s own `files` negation handling for that specific nested,
 * dot-prefixed directory shape, root cause not chased further — this script sidesteps the inconsistency
 * entirely rather than depending on it). Run as each package's own "prepack" script (a standard npm/pnpm
 * lifecycle hook, runs automatically before both `pack` and `publish`), given a single argument: the build
 * output directory to clean, relative to that package's own root.
 *
 * Also strips a bare `vitest.config.*` at any depth — `medusa plugin:build` copies it into
 * `.medusa/server/` verbatim alongside the compiled source (confirmed via a real `pnpm pack` +
 * `tar -tzf`, T-076); it isn't a compiled `*.test.*` file so the pattern above never caught it, but it's
 * dev tooling, not something a published package should ship either.
 */
import { readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

const targetDir = process.argv[2];
if (targetDir === undefined) {
  console.error("Usage: strip-test-output.mjs <build-output-dir>");
  process.exit(1);
}

let removed = 0;

function walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return; // Directory doesn't exist yet (e.g. a build that hasn't run) — nothing to clean.
  }
  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stats = statSync(fullPath);
    if (stats.isDirectory()) {
      walk(fullPath);
    } else if (/\.test\.(js|d\.ts)(\.map)?$/.test(entry) || /^vitest\.config\./.test(entry)) {
      rmSync(fullPath);
      removed += 1;
    }
  }
}

walk(targetDir);
console.log(`strip-test-output: removed ${removed} compiled test file(s) from ${targetDir}`);
