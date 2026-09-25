import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { upBase, upMedusa, down, logs } from "./compose.js";
import { publishToVerdaccio } from "./publish.js";
import { MEDUSA_CONTAINER_NAME } from "./env.js";
import { prepareMedusaVersion } from "./medusa-version.js";

const execFileAsync = promisify(execFile);

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ARTIFACTS_DIR = path.join(HERE, "..", "..", ".artifacts");
const REPO_ROOT = path.join(HERE, "..", "..", "..");
const CONFORMANCE_COMPOSE_FILE = path.join(REPO_ROOT, "docker", "compose.conformance.yml");

/** Builds the two validator images this suite's own `assert/conformance.ts` shells out to — never a second
 * copy of the validators themselves (plan-e2e.md §3.3), just making sure the existing images exist before
 * a scenario needs them. `mustang` is left out: no scenario in this pass uses it (S1's PDF check is
 * veraPDF-only for now — Mustang byte-identical extraction is the fixture suite's own L5 round-trip job,
 * `tools/conformance/roundtrip-mustang.mjs`, not duplicated here). */
async function buildConformanceImages(): Promise<void> {
  await execFileAsync(
    "docker",
    ["compose", "-f", CONFORMANCE_COMPOSE_FILE, "build", "kosit", "verapdf"],
    {
      maxBuffer: 64 * 1024 * 1024,
    },
  );
}

/** Builds every workspace package — what `publishToVerdaccio` packs, and the plugin's list of supported
 * releases `prepareMedusaVersion` reads — so both come from this checkout, not from an earlier build. */
async function buildPackages(): Promise<void> {
  await execFileAsync("pnpm", ["-r", "build"], { cwd: REPO_ROOT, maxBuffer: 64 * 1024 * 1024 });
}

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
  // Unconditional, not best-effort, and before anything else: whatever the *previous* process left
  // running — a clean exit, a crash this function's own catch below caught, or a `kill -9`/closed
  // terminal/CI cancel that skipped both that catch and the teardown it never got to return — this
  // guarantees every run starts against nothing, never whatever docker still happens to have lying
  // around. Cleanup at the end (below) is politeness; cleanup at the start is the actual guarantee.
  await down();
  await buildPackages();

  const medusaVersion = process.env["EINVOICE_E2E_MEDUSA_VERSION"];
  if (medusaVersion !== undefined && medusaVersion !== "") {
    await prepareMedusaVersion(medusaVersion);
  }

  try {
    await upBase();
    await Promise.all([publishToVerdaccio(), buildConformanceImages()]);
    await upMedusa();
    await recordInstalledVersions();
  } catch (error) {
    // Vitest only calls the teardown this function returns — if setup itself throws before reaching the
    // `return` below, there is no teardown to call `down()` for us. Without this, a failed bring-up (e.g.
    // `upMedusa` timing out) leaves the stand running, and the next `pnpm e2e` silently reuses those
    // hours-old containers instead of the fresh stand plan-e2e.md §5 rule 2 promises. The logs come first
    // (P-53): a failed bring-up is exactly when they are needed, and `down()` deletes them with the stand.
    await collectLogs();
    await removeAppCopy(medusaVersion);
    await down().catch(() => {
      // Best-effort — the stand may already be partially torn down by whatever just failed.
    });
    throw error;
  }

  return async function teardown(): Promise<void> {
    // plan-e2e.md §5 rule 6: "один прогон — один вывод" — captured unconditionally (not just on failure)
    // for now; a real pass/fail signal from vitest's own run would let this skip on green, a refinement
    // for a later pass, not this one.
    await collectLogs();
    if (process.env["EINVOICE_E2E_KEEP_STAND"] === "1") {
      // For inspecting a failure in the running stand; the next run's own down() removes it.
      console.log("[e2e] EINVOICE_E2E_KEEP_STAND=1: the stand is left running.");
      return;
    }
    await down();
    await removeAppCopy(medusaVersion);
  };
}

/** The temporary copy of the app a version-matrix run built from (`medusa-version.ts`), if there is one. */
async function removeAppCopy(medusaVersion: string | undefined): Promise<void> {
  const appCopy = process.env["EINVOICE_E2E_APP_DIR"];
  if (medusaVersion !== undefined && medusaVersion !== "" && appCopy !== undefined) {
    await rm(appCopy, { recursive: true, force: true });
  }
}

/** Which Medusa and plugin versions the stand actually installed — the one fact a version-matrix run
 * (`EINVOICE_E2E_MEDUSA_VERSION`) must not take on trust. Printed and written to `e2e/.artifacts/`. */
async function recordInstalledVersions(): Promise<void> {
  const packages = [
    "@medusajs/medusa",
    "@medusajs/framework",
    "@medusajs/ui",
    "@normwerk/einvoice-medusa",
  ];
  const script =
    `const fs = require("fs"); console.log(${JSON.stringify(packages)}.map((p) => ` +
    `p + "@" + JSON.parse(fs.readFileSync("/app/node_modules/" + p + "/package.json", "utf8")).version).join(" "))`;
  const { stdout } = await execFileAsync("docker", [
    "exec",
    MEDUSA_CONTAINER_NAME,
    "node",
    "-e",
    script,
  ]);
  const versions = stdout.trim();
  console.log(`[e2e] installed: ${versions}`);
  await mkdir(ARTIFACTS_DIR, { recursive: true });
  await writeFile(path.join(ARTIFACTS_DIR, "versions.txt"), `${versions}\n`);
}

/** Writes each service's log to `e2e/.artifacts/`, best-effort: a service that never started has none. */
async function collectLogs(): Promise<void> {
  await mkdir(ARTIFACTS_DIR, { recursive: true });
  await Promise.all(
    ["medusa", "postgres", "verdaccio"].map((service) =>
      logs(service)
        .then((text) => writeFile(path.join(ARTIFACTS_DIR, `${service}.log`), text))
        .catch(() => {
          // The service may never have started, or the stand may be half torn down — best-effort.
        }),
    ),
  );
}
