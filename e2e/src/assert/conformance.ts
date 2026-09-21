import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const execFileAsync = promisify(execFile);
const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const CLI_PATH = path.join(REPO_ROOT, "packages", "einvoice-conformance", "dist", "cli.js");

export interface ConformanceResult {
  readonly tool: string;
  readonly valid: boolean;
  readonly accepted?: boolean;
  readonly messages: readonly {
    readonly level: string;
    readonly code: string | null;
    readonly text: string;
  }[];
}

/**
 * Runs the real, existing `pnpm conformance validate` (`packages/einvoice-conformance`) against a
 * downloaded XML or PDF — the same KoSIT Validator / veraPDF the fixture-based conformance suite already
 * uses, never a second copy of either (plan-e2e.md §3.3: "валидаторы не дублируются"). The CLI needs an
 * *absolute* path (it derives the Docker bind-mount directory from `dirname(filePath)`, verified against a
 * real run — a relative path silently mounts the current working directory instead), which is why this
 * always writes to a fresh temp directory rather than accepting a caller-supplied path.
 *
 * Preconditions this doesn't manage itself (the harness's own `publishToVerdaccio` and the compose
 * validator images already cover both by the time any scenario runs): `packages/einvoice-conformance` is
 * built, and the relevant validator image(s) (`docker/compose.conformance.yml`) are built.
 */
export async function validateBytes(bytes: Buffer, filename: string): Promise<ConformanceResult> {
  const dir = await mkdtemp(path.join(tmpdir(), "einvoice-e2e-conformance-"));
  const filePath = path.join(dir, filename);
  await writeFile(filePath, bytes);
  try {
    const { stdout } = await execFileAsync("node", [CLI_PATH, "validate", filePath], {
      maxBuffer: 16 * 1024 * 1024,
    }).catch((error: { readonly stdout?: string }) => {
      // `cli.js` exits non-zero for "document rejected", not just "tool crashed" — same reasoning as its
      // own `runDocker` helper, its own doc comment.
      if (typeof error.stdout === "string") {
        return { stdout: error.stdout };
      }
      throw error;
    });
    return JSON.parse(stdout) as ConformanceResult;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
