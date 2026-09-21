import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { mkdtemp, readFile, writeFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { VERDACCIO_URL, PUBLISHED_PACKAGE_DIRS } from "./env.js";

const execFileAsync = promisify(execFile);
const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

// macOS's own `tar` writes `._*` AppleDouble sidecar files for extended attributes unless this is set —
// verified against a real run: one such file (`modules/._einvoice`, next to the real `modules/einvoice`)
// was enough to make Medusa's own module auto-discovery inside the container try to load it as a second,
// bogus module and crash on boot. A no-op on Linux (CI), where `tar` never writes these in the first place.
const TAR_ENV = { ...process.env, COPYFILE_DISABLE: "1" };

async function packOne(dir: string, destination: string): Promise<string> {
  const pkgDir = path.join(REPO_ROOT, "packages", dir);
  await execFileAsync("pnpm", ["-C", pkgDir, "pack", "--pack-destination", destination], {
    maxBuffer: 64 * 1024 * 1024,
  });
  const [tarballName] = (await readdir(destination)).filter((name) => name.endsWith(".tgz"));
  if (tarballName === undefined) {
    throw new Error(`pnpm pack for packages/${dir} produced no .tgz in ${destination}`);
  }
  return path.join(destination, tarballName);
}

/** Strips `publishConfig.provenance` from a disposable, already-packed copy of the tarball — never the
 * committed `package.json` this repo ships (see `publishToVerdaccio`'s own doc comment for why this is
 * necessary at all). Returns the path to the re-packed, patched tarball. */
async function stripProvenance(tarballPath: string, workDir: string): Promise<string> {
  const extractDir = path.join(workDir, path.basename(tarballPath, ".tgz") + "-extracted");
  await execFileAsync("mkdir", ["-p", extractDir]);
  await execFileAsync("tar", ["xzf", tarballPath, "-C", extractDir], { env: TAR_ENV });

  const packageJsonPath = path.join(extractDir, "package", "package.json");
  const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8")) as {
    publishConfig?: { provenance?: boolean };
  };
  delete packageJson.publishConfig?.provenance;
  await writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2));

  const patchedTarball = path.join(workDir, path.basename(tarballPath));
  await execFileAsync("tar", ["czf", patchedTarball, "-C", extractDir, "package"], {
    env: TAR_ENV,
  });
  return patchedTarball;
}

/**
 * Publishes the six packages this repo actually publishes (`env.ts`'s `PUBLISHED_PACKAGE_DIRS`) to the
 * stand's own Verdaccio.
 *
 * Not a plain `pnpm -r publish` (plan-e2e.md §3.3's own "the same command release will use") — verified
 * against a real run that this doesn't work here: every package's own `publishConfig.provenance: true` is,
 * by design, not something a *local* override (CLI flag or npmrc) is allowed to silently strip — real
 * npm/pnpm behavior, meant to stop a compromised local environment from stripping a package's own
 * attestation. A real publish to the real npm registry from real CI (`release.yml`) satisfies that check
 * normally (GitHub Actions OIDC); a local Verdaccio never can. So each package is packed with `pnpm pack`
 * first — which still does the real `workspace:*` → resolved-version rewrite a release depends on — then
 * has only its own `publishConfig.provenance` stripped from that disposable, already-built copy before
 * publishing it from the patched tarball. The committed `package.json` this repo ships is never touched.
 */
export async function publishToVerdaccio(): Promise<void> {
  await execFileAsync("pnpm", ["-r", "build"], { cwd: REPO_ROOT, maxBuffer: 64 * 1024 * 1024 });

  const workDir = await mkdtemp(path.join(tmpdir(), "einvoice-e2e-publish-"));
  const npmrcPath = path.join(workDir, ".npmrc");
  const verdaccioHost = new URL(VERDACCIO_URL).host;
  // A throwaway local registry with `publish: $all` (e2e/docker/verdaccio/config.yaml) doesn't actually
  // check this token, but npm still refuses to attempt a publish with no token configured at all for the
  // target registry — an isolated user-config file avoids writing a fake credential into this repo's own
  // committed .npmrc.
  await writeFile(
    npmrcPath,
    `registry=${VERDACCIO_URL}/\n//${verdaccioHost}/:_authToken=einvoice-e2e-local-only\n`,
  );
  const publishEnv = { ...process.env, NPM_CONFIG_USERCONFIG: npmrcPath };

  try {
    for (const dir of PUBLISHED_PACKAGE_DIRS) {
      const tarball = await packOne(dir, path.join(workDir, `${dir}-pack`));
      const patched = await stripProvenance(tarball, workDir);
      await execFileAsync("npm", ["publish", patched, "--registry", VERDACCIO_URL], {
        cwd: REPO_ROOT,
        maxBuffer: 64 * 1024 * 1024,
        env: publishEnv,
      });
    }
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}
