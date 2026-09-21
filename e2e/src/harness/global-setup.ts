import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { upBase, upMedusa, down, logs } from "./compose.js";
import { publishToVerdaccio } from "./publish.js";

const ARTIFACTS_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  ".artifacts",
);

/**
 * Vitest's `globalSetup` — runs exactly once before any scenario file, in the main process (not per
 * worker), which is why the stand's lifecycle lives here rather than in a per-file `beforeAll`
 * (plan-e2e.md §3.4/§5 rule 4: one shared stand, no parallelism across scenario files —
 * `vitest.config.ts` also sets `fileParallelism: false` so that holds even if a call site forgets it).
 *
 * `docker compose up -d --wait` already gates on each service's own HTTP healthcheck (plan-e2e.md §5 rule 3
 * — "готовность по HTTP-healthcheck, не по 'контейнер запустился'", `docker/compose.e2e.yml`'s own
 * healthchecks) — no extra polling needed here on top of that.
 */
export default async function setup(): Promise<() => Promise<void>> {
  await upBase();
  await publishToVerdaccio();
  await upMedusa();

  return async function teardown(): Promise<void> {
    // plan-e2e.md §5 rule 6: "один прогон — один вывод" — captured unconditionally (not just on failure)
    // for now; a real pass/fail signal from vitest's own run would let this skip on green, a refinement
    // for a later pass, not this one.
    await mkdir(ARTIFACTS_DIR, { recursive: true });
    await Promise.all([
      logs("medusa").then((text) => writeFile(path.join(ARTIFACTS_DIR, "medusa.log"), text)),
      logs("postgres").then((text) => writeFile(path.join(ARTIFACTS_DIR, "postgres.log"), text)),
      logs("verdaccio").then((text) => writeFile(path.join(ARTIFACTS_DIR, "verdaccio.log"), text)),
    ]).catch(() => {
      // The stand may already be half torn down by the time this runs in some failure modes — best-effort.
    });
    await down();
  };
}
