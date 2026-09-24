import { execFile } from "node:child_process";
import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.join(HERE, "..", "..", "app");
const DOCKERFILE = path.join(HERE, "..", "..", "docker", "medusa", "Dockerfile");

/** The dashboard's own dependencies name the companion versions a Medusa release was built with. */
const COMPANIONS = [
  "@medusajs/ui",
  "react-router-dom",
  "zod",
  "@tanstack/react-query",
  "react-i18next",
];

/** The lowest release the plugin's peer dependencies accept; an older one installs only with
 * `--legacy-peer-deps`, which is what testing below that floor is for. */
const PEER_FLOOR: readonly [number, number] = [2, 19];

interface AppPackageJson {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
}

async function npmView(spec: string, field: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync("npm", ["view", spec, field, "--json"]);
    return stdout.trim();
  } catch {
    return "";
  }
}

function belowPeerFloor(version: string): boolean {
  const [major = 0, minor = 0] = version.split(".").map(Number);
  return major < PEER_FLOOR[0] || (major === PEER_FLOOR[0] && minor < PEER_FLOOR[1]);
}

/**
 * P-59 item 8: runs the stand against another Medusa release than the one `e2e/app` pins. Copies the app
 * to a temporary directory, sets every `@medusajs/*` package to `version` — dropping one that release does
 * not have yet — and its UI and router companions to what that release's dashboard depends on, then points
 * `docker/compose.e2e.yml` at the copy (`EINVOICE_E2E_APP_DIR`, `EINVOICE_E2E_MEDUSA_DOCKERFILE`). The
 * committed app is never touched, so a plain `pnpm e2e` still runs the pinned version.
 */
export async function prepareMedusaVersion(version: string): Promise<void> {
  const dashboardDeps = JSON.parse(
    (await npmView(`@medusajs/dashboard@${version}`, "dependencies")) || "null",
  ) as Record<string, string> | null;
  if (dashboardDeps === null) {
    throw new Error(
      `EINVOICE_E2E_MEDUSA_VERSION=${version}: npm has no @medusajs/dashboard@${version}.`,
    );
  }

  const pkg = JSON.parse(
    await readFile(path.join(APP_DIR, "package.json"), "utf8"),
  ) as AppPackageJson;
  /** A dependency's version for this release, or `undefined` for a package the release does not have yet. */
  const versionFor = async (name: string, current: string): Promise<string | undefined> => {
    if (COMPANIONS.includes(name)) return dashboardDeps[name] ?? current;
    if (!name.startsWith("@medusajs/")) return current;
    return (await npmView(`${name}@${version}`, "version")) === "" ? undefined : version;
  };
  const retarget = async (deps: Record<string, string>): Promise<Record<string, string>> => {
    const entries = await Promise.all(
      Object.entries(deps).map(async ([name, current]) => [name, await versionFor(name, current)]),
    );
    return Object.fromEntries(
      entries.filter((entry): entry is [string, string] => entry[1] !== undefined),
    );
  };
  pkg.dependencies = await retarget(pkg.dependencies);
  pkg.devDependencies = await retarget(pkg.devDependencies);

  // With --legacy-peer-deps npm installs no peer dependency at all. Older releases declare their ORM,
  // container and database driver as peers of @medusajs/medusa and @medusajs/framework, and the scaffold
  // of their day listed them in the app itself — without them 2.4.0 does not start ("Cannot find module
  // '@mikro-orm/core'"). So they are added the same way, except the optional ones.
  if (belowPeerFloor(version)) {
    for (const name of Object.keys(pkg.dependencies).filter((n) => n.startsWith("@medusajs/"))) {
      const peers = JSON.parse(
        (await npmView(`${name}@${version}`, "peerDependencies")) || "{}",
      ) as Record<string, string>;
      const meta = JSON.parse(
        (await npmView(`${name}@${version}`, "peerDependenciesMeta")) || "{}",
      ) as Record<string, { optional?: boolean }>;
      for (const [peer, range] of Object.entries(peers)) {
        if (peer.startsWith("@medusajs/") || meta[peer]?.optional === true) continue;
        if (pkg.dependencies[peer] === undefined && pkg.devDependencies[peer] === undefined) {
          pkg.dependencies[peer] = range;
        }
      }
    }
  }

  const dir = await mkdtemp(path.join(tmpdir(), `einvoice-e2e-medusa-${version}-`));
  await cp(APP_DIR, dir, { recursive: true });
  await writeFile(path.join(dir, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`);

  process.env["EINVOICE_E2E_APP_DIR"] = dir;
  process.env["EINVOICE_E2E_MEDUSA_DOCKERFILE"] = DOCKERFILE;
  process.env["EINVOICE_E2E_NPM_INSTALL_FLAGS"] = belowPeerFloor(version)
    ? "--legacy-peer-deps"
    : "";
  console.log(
    `[e2e] Medusa ${version}: app copied to ${dir}` +
      (belowPeerFloor(version)
        ? ", installed with --legacy-peer-deps (below the plugin's peer range)"
        : ""),
  );
}
