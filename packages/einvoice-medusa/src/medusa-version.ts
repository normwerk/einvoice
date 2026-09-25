/**
 * The Medusa releases this plugin supports: those its end-to-end suite passes on, each minor line run at
 * its latest patch (`packages/einvoice-medusa/README.md#compatibility`, `docs/e2e.md`). Declared once here:
 * the `@medusajs/*` peer dependency ranges in `package.json` are checked against it by a unit test, and the
 * module refuses to start on any other release (`assertSupportedMedusaVersion`) — a package manager that only
 * warns about peers would otherwise let the plugin run where it issues wrong invoices.
 *
 * 2.16 and 2.17 are left out: in the test store Medusa charged no VAT on products there, only on shipping,
 * so every domestic order is refused (P-59 item 8).
 */
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { PluginError } from "./errors.js";

/** A half-open range of releases: `from` included, `below` not. */
export interface MedusaVersionRange {
  readonly from: string;
  readonly below: string;
}

export const SUPPORTED_MEDUSA_VERSIONS: readonly MedusaVersionRange[] = [
  { from: "2.12.0", below: "2.16.0" },
  { from: "2.18.0", below: "3.0.0" },
];

/** The same ranges as an npm peer dependency range. */
export function supportedMedusaPeerRange(
  ranges: readonly MedusaVersionRange[] = SUPPORTED_MEDUSA_VERSIONS,
): string {
  return ranges.map((range) => `>=${range.from} <${range.below}`).join(" || ");
}

function parts(version: string): readonly [number, number, number] | undefined {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (match === null) return undefined;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compare(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < 3; i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** Whether a release (`2.18.0`; a prerelease counts as its release) is inside the supported ranges. */
export function isSupportedMedusaVersion(
  version: string,
  ranges: readonly MedusaVersionRange[] = SUPPORTED_MEDUSA_VERSIONS,
): boolean {
  const v = parts(version);
  if (v === undefined) return false;
  return ranges.some((range) => {
    const from = parts(range.from);
    const below = parts(range.below);
    return (
      from !== undefined && below !== undefined && compare(v, from) >= 0 && compare(v, below) < 0
    );
  });
}

/** "2.12–2.15, 2.18 or later 2.x" — for messages; minor lines, since each line is tested at its latest patch. */
export function describeSupportedMedusaVersions(
  ranges: readonly MedusaVersionRange[] = SUPPORTED_MEDUSA_VERSIONS,
): string {
  return ranges
    .map((range) => {
      const [fromMajor, fromMinor] = parts(range.from) ?? [0, 0];
      const [belowMajor, belowMinor] = parts(range.below) ?? [0, 0];
      if (belowMajor > fromMajor) return `${fromMajor}.${fromMinor} or a later ${fromMajor}.x`;
      const last = belowMinor - 1;
      return last === fromMinor
        ? `${fromMajor}.${fromMinor}`
        : `${fromMajor}.${fromMinor}–${fromMajor}.${last}`;
    })
    .join(", ");
}

/** The `@medusajs/framework` version of the app being started — resolved from its root (`process.cwd()`, where
 * `medusa` runs) and read from the package's own `package.json`, which its `exports` do not expose — or
 * `undefined` if it cannot be found. */
export function installedMedusaVersion(appRoot: string = process.cwd()): string | undefined {
  let dir: string;
  try {
    dir = path.dirname(
      createRequire(path.join(appRoot, "package.json")).resolve("@medusajs/framework"),
    );
  } catch {
    return undefined;
  }
  while (dir !== path.dirname(dir)) {
    const candidate = path.join(dir, "package.json");
    if (existsSync(candidate)) {
      const pkg = JSON.parse(readFileSync(candidate, "utf8")) as {
        name?: string;
        version?: string;
      };
      if (pkg.name === "@medusajs/framework") return pkg.version;
    }
    dir = path.dirname(dir);
  }
  return undefined;
}

export class UnsupportedMedusaVersionError extends PluginError {
  constructor(readonly installed: string | undefined) {
    super(
      "UNSUPPORTED_MEDUSA_VERSION",
      (installed === undefined
        ? "@normwerk/einvoice-medusa could not determine the installed Medusa version (@medusajs/framework)"
        : `@normwerk/einvoice-medusa does not support Medusa ${installed}`) +
        ` — it runs on Medusa ${describeSupportedMedusaVersions()}, the releases its end-to-end suite passes on ` +
        "(compatibility table: https://github.com/normwerk/einvoice/blob/main/packages/einvoice-medusa/README.md#compatibility). " +
        "For another release, a pull request is welcome at https://github.com/normwerk/einvoice, or write to " +
        "hello@normwerk.dev about adapting it.",
    );
    this.name = "UnsupportedMedusaVersionError";
  }
}

/** Refuses to start on a Medusa release outside `SUPPORTED_MEDUSA_VERSIONS`. */
export function assertSupportedMedusaVersion(installed: string | undefined): void {
  if (installed === undefined || !isSupportedMedusaVersion(installed)) {
    throw new UnsupportedMedusaVersionError(installed);
  }
}
