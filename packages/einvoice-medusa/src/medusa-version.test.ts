import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  UnsupportedMedusaVersionError,
  assertSupportedMedusaVersion,
  describeSupportedMedusaVersions,
  installedMedusaVersion,
  isSupportedMedusaVersion,
  supportedMedusaPeerRange,
} from "./medusa-version.js";

describe("supported Medusa releases", () => {
  it("covers the releases the end-to-end suite passes on, and nothing else", () => {
    for (const version of ["2.12.0", "2.12.6", "2.15.5", "2.18.0", "2.19.0", "2.21.1", "2.99.0"]) {
      expect(isSupportedMedusaVersion(version), version).toBe(true);
    }
    // 2.16/2.17: Medusa charged no VAT on products in the test store; below 2.12 and 3.x: never run.
    for (const version of ["2.11.3", "2.16.0", "2.17.2", "3.0.0", "not-a-version"]) {
      expect(isSupportedMedusaVersion(version), version).toBe(false);
    }
  });

  it("is the range every @medusajs peer dependency declares", () => {
    // `__dirname`, not `import.meta.url`: this package compiles to CommonJS (see tax-matrix/load-cells.ts).
    const pkg = JSON.parse(readFileSync(resolve(__dirname, "../package.json"), "utf8")) as {
      peerDependencies: Record<string, string>;
    };
    const medusaPeers = Object.entries(pkg.peerDependencies).filter(
      ([name]) => name.startsWith("@medusajs/") && name !== "@medusajs/ui",
    );
    expect(medusaPeers.length).toBeGreaterThan(0);
    for (const [name, range] of medusaPeers) {
      expect(range, name).toBe(supportedMedusaPeerRange());
    }
    expect(supportedMedusaPeerRange()).toBe(">=2.12.0 <2.16.0 || >=2.18.0 <3.0.0");
    expect(describeSupportedMedusaVersions()).toBe("2.12–2.15, 2.18 or a later 2.x");
  });

  it("refuses to start on another release, pointing to a pull request or to hello@normwerk.dev", () => {
    expect(() => assertSupportedMedusaVersion("2.21.0")).not.toThrow();
    expect(() => assertSupportedMedusaVersion("2.17.2")).toThrow(UnsupportedMedusaVersionError);
    expect(() => assertSupportedMedusaVersion("2.17.2")).toThrow(
      /does not support Medusa 2\.17\.2 — it runs on Medusa 2\.12–2\.15, 2\.18 or a later 2\.x.*pull request.*hello@normwerk\.dev/,
    );
    expect(() => assertSupportedMedusaVersion(undefined)).toThrow(/could not determine/);
  });

  it("reads the installed @medusajs/framework version from the app root", () => {
    expect(installedMedusaVersion()).toBe("2.21.2");
    expect(installedMedusaVersion("/nonexistent")).toBeUndefined();
  });
});
