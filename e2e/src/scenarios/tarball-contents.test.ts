import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PUBLISHED_PACKAGE_DIRS } from "../harness/env.js";

const execFileAsync = promisify(execFile);
const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

interface NpmPackEntry {
  readonly files: readonly { readonly path: string }[];
}

// plan-e2e.md §4/§8: "npm pack --dry-run по шести пакетам: внутри нет тестов, фикстур и лишних исходников."
// Doesn't need the stand at all — runs against the working tree directly, same six packages
// `harness/publish.ts` publishes (`env.ts`'s `PUBLISHED_PACKAGE_DIRS`).
describe("tarball contents: no tests or fixtures ship in any published package", () => {
  it.each(PUBLISHED_PACKAGE_DIRS)(
    "packages/%s",
    async (dir) => {
      const packageDir = path.join(REPO_ROOT, "packages", dir);
      const { stdout } = await execFileAsync("npm", ["pack", "--dry-run", "--json"], {
        cwd: packageDir,
        maxBuffer: 16 * 1024 * 1024,
      });
      // `prepack` lifecycle scripts (e.g. strip-test-output.mjs) print their own lines to stdout before
      // npm's own JSON array — verified against a real run, not a hypothetical.
      const jsonStart = stdout.indexOf("[");
      const jsonEnd = stdout.lastIndexOf("]") + 1;
      const [entry] = JSON.parse(stdout.slice(jsonStart, jsonEnd)) as readonly NpmPackEntry[];
      if (entry === undefined) {
        throw new Error(`npm pack --dry-run for packages/${dir} produced no entries`);
      }

      const suspicious = entry.files
        .map((f) => f.path)
        .filter((p) => /\.test\.|__fixtures__|(^|\/)fixtures\//.test(p));
      expect(suspicious).toEqual([]);
    },
    60_000,
  );
});
