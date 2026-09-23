#!/usr/bin/env node
/**
 * T-003 (plan-v0.1 §3.6, release checklist §10): "запрет copyleft в runtime-зависимостях, allow-list в
 * devDependencies (WTFPL, EUPL-1.2 только dev)". CI's own acceptance is "падает на нарушении" (fails on a
 * violation) — this script is that gate, run as its own `pnpm license-scan`.
 *
 * Two separately-scoped closures, not one flat scan of the whole workspace:
 *
 * 1. **Runtime**: the actual `dependencies` field (never `devDependencies`) of each of this monorepo's
 *    *published* packages (every `packages/*` without `"private": true`, `PUBLISHED_PACKAGES` below), walked
 *    transitively through every dependency's own `dependencies` field in turn —
 *    this is the real, precise definition of "what ships inside a consumer's own `node_modules` when they
 *    install one of our packages," which is what the release checklist's own "только MIT/Apache-2.0/BSD/
 *    ISC" wording is actually about. A `"private": true` package (today `einvoice-ubl`) is never published,
 *    so its dependencies are dev-tier from an external consumer's point of view, not runtime.
 *
 *    `pnpm licenses list --prod` (tried first, T-003's own research) does *not* give this: run at the
 *    workspace root it also walks into every *devDependency*'s own transitive prod dependencies (e.g.
 *    `@medusajs/medusa` is one of `einvoice-medusa`'s own devDependencies, reached only for local
 *    development/testing — but `pnpm licenses list --prod` still reports its entire own dependency tree,
 *    hundreds of packages that never ship in what we actually publish). A hand-rolled walk restricted to
 *    each published package's own `dependencies` edges is what actually answers the right question.
 *
 * 2. **Dev**: every workspace package's (plus the repo root's) own `devDependencies`, walked transitively
 *    the same way. Checked against a *wider* allow-list (`DEV_ALLOWED_LICENSES`) — devDependencies never
 *    redistribute, so the bar is lower, but "allow-list в devDependencies" (plan-v0.1's own wording) still
 *    means an allow-list, not no check at all.
 *
 * Resolution uses real Node module resolution (`createRequire(...).resolve`), which works correctly against
 * pnpm's own `.pnpm` virtual store the same way `require`/`import` do at runtime — not a lockfile parse,
 * which would risk drifting from what's actually installed.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ACKNOWLEDGED_PROPRIETARY_DEV_DEPENDENCIES,
  DEV_ALLOWED_LICENSES,
  KNOWN_DEV_LICENSE_OVERRIDES,
  RUNTIME_ALLOWED_LICENSES,
  isLicenseAllowed,
  normalizeLicenseField,
} from "./license-policy.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
function readJson(path) {
  return JSON.parse(readFileSync(path, "utf-8"));
}

/**
 * Every workspace package without `"private": true` — the same field `pnpm -r publish` itself decides by,
 * so this list cannot drift from what is actually published. It used to be a hand-kept list that missed
 * `einvoice-conformance` after that package became publishable, which would have checked its runtime
 * dependencies against the wider dev allow-list (P-52).
 */
const PUBLISHED_PACKAGES = readdirSync(join(REPO_ROOT, "packages"))
  .filter((name) => existsSync(join(REPO_ROOT, "packages", name, "package.json")))
  .filter((name) => readJson(join(REPO_ROOT, "packages", name, "package.json")).private !== true)
  .sort();

function listWorkspacePackageDirs() {
  const packagesDir = join(REPO_ROOT, "packages");
  return readdirSync(packagesDir)
    .map((name) => join(packagesDir, name))
    .filter((dir) => statSync(dir).isDirectory());
}

/**
 * Last-resort lookup: scans `node_modules/.pnpm/` directly for `depName`, pnpm's own on-disk virtual
 * store — real, needed because a dependency several levels deep in a large devDependency tree isn't always
 * reachable via ordinary Node resolution walked from *its own* nested position (confirmed on a real case:
 * `@medusajs/framework -> lodash.memoize` realpath's into a `.pnpm` entry whose own sibling `node_modules`
 * doesn't contain every one of its dependencies directly — pnpm hoists some shared ones out instead — and
 * `lodash.memoize` isn't a *direct* dependency of this monorepo's own root or any workspace package either,
 * so it never gets a top-level `node_modules/lodash.memoize` symlink for `resolve.paths` to find from the
 * repo root). pnpm's own directory naming for a scoped package (`@scope/name`) is `@scope+name` — encoded
 * here to match, not guessed.
 */
function findInPnpmStore(depName) {
  const pnpmStoreDir = join(REPO_ROOT, "node_modules", ".pnpm");
  if (!existsSync(pnpmStoreDir)) {
    return undefined;
  }
  const encodedName = depName.startsWith("@") ? depName.replace("/", "+") : depName;
  const prefix = `${encodedName}@`;
  for (const entry of readdirSync(pnpmStoreDir)) {
    if (!entry.startsWith(prefix)) {
      continue;
    }
    const candidate = join(pnpmStoreDir, entry, "node_modules", depName, "package.json");
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

/**
 * Resolves `depName`'s own `package.json`, starting Node's module resolution from `fromDir` — the same
 * real resolution `import`/`require` use, so this walks exactly what's actually installed, not a
 * theoretical dependency graph.
 *
 * Many real, currently-installed packages (confirmed empirically, not assumed — a first version of this
 * scan hit this on well over a dozen real dependencies) declare an `"exports"` map that does *not* include
 * `"./package.json"` as an explicit subpath. Node's own `require.resolve` honors that map even for a
 * CommonJS-style resolve, so `${depName}/package.json` fails with `ERR_PACKAGE_PATH_NOT_EXPORTED` even
 * though the file is sitting right there on disk. `require.resolve.paths(depName)` (walking `node_modules`
 * directories up from `fromDir`, bypassing "exports" by checking the filesystem directly) covers most of
 * these, but not all: a package several levels deep in a large devDependency tree can realpath (through a
 * pnpm symlink) into a `.pnpm` store entry whose own sibling `node_modules` doesn't contain every one of
 * *its* dependencies directly (pnpm hoists some shared ones out instead), and the same dependency isn't
 * always a *direct* dependency of this monorepo's own root either — confirmed on a real case,
 * `@medusajs/framework -> lodash.memoize`, unreachable by `resolve.paths` from either its own nested
 * position or the repo root. `findInPnpmStore` is the actually-robust fallback for that: pnpm's own on-disk
 * virtual store names every installed package+version once, directly, regardless of how deep or shared it
 * is — scanning it directly finds what real module resolution, walked from any single starting point,
 * sometimes can't.
 */
function resolveDepPackageJson(fromDir, depName) {
  const req = createRequire(join(fromDir, "package.json"));
  try {
    return req.resolve(`${depName}/package.json`);
  } catch (primaryError) {
    const searchPaths = req.resolve.paths(depName) ?? [];
    for (const candidateDir of searchPaths) {
      const candidate = join(candidateDir, depName, "package.json");
      if (existsSync(candidate)) {
        return candidate;
      }
    }
    const fromStore = findInPnpmStore(depName);
    if (fromStore !== undefined) {
      return fromStore;
    }
    throw primaryError;
  }
}

/**
 * Walks `packageJson[fieldName]` (e.g. `"dependencies"`) transitively against `allowedSet` — every
 * dependency found is then walked through *its own* `"dependencies"` (never its `devDependencies`; a
 * resolved, installed package's devDependencies aren't materialized in `node_modules` at all, so there is
 * nothing to walk there even if we wanted to), still checked against the same `allowedSet` the top-level
 * call started with — the tier (runtime vs. dev) is a property of *where this walk started*, not of which
 * field name is being read at a given recursion depth.
 */
function walkClosure(startDir, fieldName, allowedSet, tier, state) {
  const packageJsonPath = join(startDir, "package.json");
  const packageJson = readJson(packageJsonPath);
  const depNames = Object.keys(packageJson[fieldName] ?? {});
  for (const depName of depNames) {
    let depPackageJsonPath;
    try {
      depPackageJsonPath = resolveDepPackageJson(startDir, depName);
    } catch (error) {
      state.errors.push({
        from: packageJson.name,
        dependency: depName,
        message: String(error.message),
      });
      continue;
    }
    const depPackageJson = readJson(depPackageJsonPath);
    const key = `${depPackageJson.name}@${depPackageJson.version}`;
    if (state.visited.has(key)) {
      continue;
    }
    state.visited.add(key);
    // Dev-tier only, and only for a package individually justified in KNOWN_DEV_LICENSE_OVERRIDES's own
    // doc comment — the override replaces an unusable declared value ("UNKNOWN"/"SEE LICENSE IN LICENSE"),
    // it never overrides a real, already-parseable SPDX identifier.
    const overrideLicense =
      tier === "dev" ? KNOWN_DEV_LICENSE_OVERRIDES.get(depPackageJson.name) : undefined;
    const normalized =
      overrideLicense === undefined
        ? normalizeLicenseField(depPackageJson)
        : { identifiers: [overrideLicense], requiresAll: false };
    const licenseDisplay = normalized.requiresAll
      ? `(${normalized.identifiers.join(" AND ")})`
      : normalized.identifiers.join(" OR ");
    state.resolved.set(key, {
      name: depPackageJson.name,
      version: depPackageJson.version,
      license: licenseDisplay,
    });
    const acknowledged =
      tier === "dev" && ACKNOWLEDGED_PROPRIETARY_DEV_DEPENDENCIES.has(depPackageJson.name);
    if (!acknowledged && !isLicenseAllowed(normalized, allowedSet)) {
      state.violations.push({ tier, key, license: licenseDisplay });
    }
    walkClosure(dirname(depPackageJsonPath), "dependencies", allowedSet, tier, state);
  }
}

function newState() {
  return { visited: new Set(), violations: [], resolved: new Map(), errors: [] };
}

function scanRuntime() {
  const state = newState();
  for (const name of PUBLISHED_PACKAGES) {
    walkClosure(
      join(REPO_ROOT, "packages", name),
      "dependencies",
      RUNTIME_ALLOWED_LICENSES,
      "runtime",
      state,
    );
  }
  return state;
}

function scanDev() {
  const state = newState();
  const dirs = [REPO_ROOT, ...listWorkspacePackageDirs()];
  for (const dir of dirs) {
    walkClosure(dir, "devDependencies", DEV_ALLOWED_LICENSES, "dev", state);
  }
  return state;
}

function main() {
  const runtime = scanRuntime();
  const dev = scanDev();

  console.log(`Runtime closure: ${runtime.resolved.size} unique package(s) checked.`);
  console.log(`Dev closure: ${dev.resolved.size} unique package(s) checked.`);

  const allViolations = [...runtime.violations, ...dev.violations];
  const allErrors = [...runtime.errors, ...dev.errors];

  if (allErrors.length > 0) {
    console.log(`\n${allErrors.length} resolution error(s):`);
    for (const error of allErrors) {
      console.log(`  ${error.from} -> ${error.dependency}: ${error.message}`);
    }
  }

  if (allViolations.length > 0) {
    console.log(`\n${allViolations.length} license violation(s):`);
    for (const violation of allViolations) {
      console.log(`  [${violation.tier}] ${violation.key}: ${violation.license}`);
    }
    console.log("\nFAIL: license-scan found a dependency license outside the allowed set.");
    process.exit(1);
  }

  if (allErrors.length > 0) {
    console.log("\nFAIL: license-scan could not resolve every dependency (see above).");
    process.exit(1);
  }

  console.log("\nPASS: every runtime and dev dependency license is on the allow-list.");
}

main();
