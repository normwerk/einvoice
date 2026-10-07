/**
 * T-214: what the dry-run report's header names — the plugin, Medusa, Node.js and the core packages as
 * installed in the shop, and the hash of the VAT rules they apply. The rules are code in this release: the
 * hash covers the `@normwerk/einvoice-commerce` modules that hold them, so the same version with a locally
 * patched rule shows another hash.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type { PackageVersion } from "@normwerk/einvoice-conformance" with {
  "resolution-mode": "import",
};
import { installedMedusaVersion } from "../medusa-version.js";

const PLUGIN = "@normwerk/einvoice-medusa";
const CORE_PACKAGES = [
  "@normwerk/einvoice-commerce",
  "@normwerk/einvoice-cii",
  "@normwerk/einvoice-model",
] as const;
/** The tax rules, Germany's VAT rate periods, the supported countries — in this order. */
const RULE_MODULES = ["tax-rules.js", "de-vat-rates.js", "supported-jurisdictions.js"] as const;

export interface DryRunVersions {
  readonly plugin: PackageVersion;
  readonly platform: PackageVersion;
  readonly nodeVersion: string;
  readonly core: readonly PackageVersion[];
  readonly rulesSha256: string;
}

/** The version in the `package.json` named `name` at `from` or above it. */
function versionAbove(from: string, name: string): string {
  let dir = from;
  while (dir !== path.dirname(dir)) {
    const candidate = path.join(dir, "package.json");
    if (existsSync(candidate)) {
      const pkg = JSON.parse(readFileSync(candidate, "utf8")) as {
        readonly name?: string;
        readonly version?: string;
      };
      if (pkg.name === name && pkg.version !== undefined) return pkg.version;
    }
    dir = path.dirname(dir);
  }
  return "unknown";
}

export function installedVersions(appRoot: string = process.cwd()): DryRunVersions {
  // The core packages are the plugin's own dependencies: resolved from here, not from the shop's root.
  const own = createRequire(__filename);
  const entryOf = (name: string): string => path.dirname(own.resolve(name));
  const rules = createHash("sha256");
  for (const file of RULE_MODULES) {
    rules.update(readFileSync(path.join(entryOf("@normwerk/einvoice-commerce"), file)));
  }
  return {
    plugin: { name: PLUGIN, version: versionAbove(__dirname, PLUGIN) },
    platform: { name: "Medusa", version: installedMedusaVersion(appRoot) ?? "unknown" },
    nodeVersion: process.versions.node,
    core: CORE_PACKAGES.map((name) => ({ name, version: versionAbove(entryOf(name), name) })),
    rulesSha256: rules.digest("hex"),
  };
}
