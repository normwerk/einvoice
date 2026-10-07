import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { installedVersions } from "./versions.js";

const PACKAGES = path.resolve(__dirname, "../../..");

function versionOf(dir: string): string {
  return (
    JSON.parse(readFileSync(path.join(PACKAGES, dir, "package.json"), "utf8")) as {
      version: string;
    }
  ).version;
}

describe("installedVersions (T-214)", () => {
  it("names the plugin and the core packages at their versions, and hashes the commerce rule modules", () => {
    const versions = installedVersions();

    expect(versions.plugin).toEqual({
      name: "@normwerk/einvoice-medusa",
      version: versionOf("einvoice-medusa"),
    });
    expect(versions.core).toEqual([
      { name: "@normwerk/einvoice-commerce", version: versionOf("einvoice-commerce") },
      { name: "@normwerk/einvoice-cii", version: versionOf("einvoice-cii") },
      { name: "@normwerk/einvoice-model", version: versionOf("einvoice-model") },
    ]);
    const rules = createHash("sha256");
    for (const file of ["tax-rules.js", "de-vat-rates.js", "supported-jurisdictions.js"]) {
      rules.update(readFileSync(path.join(PACKAGES, "einvoice-commerce/dist", file)));
    }
    expect(versions.rulesSha256).toBe(rules.digest("hex"));
    expect(versions.nodeVersion).toBe(process.versions.node);
  });
});
