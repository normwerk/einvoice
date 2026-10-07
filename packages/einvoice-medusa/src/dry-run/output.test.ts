import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { DryRunReport } from "@normwerk/einvoice-conformance" with {
  "resolution-mode": "import",
};
import { writeDryRun } from "./output.js";

const REPORT = { schemaVersion: 1 } as unknown as DryRunReport;

describe("writeDryRun (T-214)", () => {
  it("writes the report and each XML by fulfillment id, replacing an earlier run's XML", () => {
    const folder = path.join(mkdtempSync(path.join(tmpdir(), "dry-run-")), "out");
    writeDryRun(folder, REPORT, new Map([["ful_old", "<old/>"]]));

    writeDryRun(folder, REPORT, new Map([["ful_1", "<xml/>"]]));

    expect(JSON.parse(readFileSync(path.join(folder, "report.json"), "utf8"))).toEqual(REPORT);
    expect(readdirSync(path.join(folder, "xml"))).toEqual(["ful_1.xml"]);
  });

  it("leaves a folder that holds something other than an earlier run alone", () => {
    const folder = mkdtempSync(path.join(tmpdir(), "dry-run-"));
    mkdirSync(path.join(folder, "xml"));
    writeFileSync(path.join(folder, "notes.txt"), "mine");

    expect(() => writeDryRun(folder, REPORT, new Map())).toThrow(/holds files of its own/);
    expect(existsSync(path.join(folder, "xml"))).toBe(true);
  });
});
