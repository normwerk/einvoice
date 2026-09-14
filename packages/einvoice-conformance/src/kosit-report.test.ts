import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseKositReport } from "./kosit-report";

// Real report produced by running the KoSIT Validator 1.6.3 (XRechnung
// 3.0.2 configuration) against the KoSIT test suite's own
// `01.01a-INVOICE_ubl.xml` (Apache-2.0), inside the Docker image built
// from docker/kosit/Dockerfile — captured 2026-09-12 (spike C, T-044).
const fixturePath = fileURLToPath(
  new URL("./__fixtures__/kosit-report-sample.xml", import.meta.url),
);

// Real report for a document with exactly one warning-level Schematron
// message (BR-DE-26 — a "corrected invoice" typeCode 384 without a
// preceding-invoice reference) and nothing else — captured 2026-09-14
// while writing docs/tax-semantics.md row 11 (T-052/W9). KoSIT's own
// business verdict for this document is <rep:assessment><rep:accept>,
// matching the CLI's own human-readable "Acceptable: 1, Rejected: 0" — but
// the top-level `valid` attribute is "false", the exact discrepancy this
// test file exists to cover.
const warningAcceptedFixturePath = fileURLToPath(
  new URL("./__fixtures__/kosit-report-sample-warning-accepted.xml", import.meta.url),
);

// Real report for a document with two fatal-level Schematron messages
// (BR-IC-11/BR-IC-12 — an intra-EU supply missing its mandatory delivery
// info) — captured the same day. KoSIT's own verdict is
// <rep:assessment><rep:reject>.
const rejectedFixturePath = fileURLToPath(
  new URL("./__fixtures__/kosit-report-sample-rejected.xml", import.meta.url),
);

describe("parseKositReport", () => {
  it("reads the document-level valid attribute", () => {
    const xml = readFileSync(fixturePath, "utf-8");
    expect(parseKositReport(xml).valid).toBe(true);
  });

  it("extracts BR-* messages with their level and code", () => {
    const xml = readFileSync(fixturePath, "utf-8");
    const { messages } = parseKositReport(xml);
    const brMessage = messages.find((m) => m.code === "BR-DE-TMP-32");
    expect(brMessage).toBeDefined();
    expect(brMessage?.level).toBe("information");
    expect(brMessage?.text).toContain("Liefer-/Leistungsdatums");
  });

  it("reports invalid when the report's valid attribute is false", () => {
    const xml =
      '<rep:report xmlns:rep="http://www.xoev.de/de/validator/varl/1" valid="false"></rep:report>';
    expect(parseKositReport(xml).valid).toBe(false);
  });

  it("a warning-only document is accepted by KoSIT even though valid is false (docs/tax-semantics.md row 11)", () => {
    const xml = readFileSync(warningAcceptedFixturePath, "utf-8");
    const result = parseKositReport(xml);
    expect(result.valid).toBe(false);
    expect(result.accepted).toBe(true);
    expect(result.messages.map((m) => m.code)).toContain("BR-DE-26");
    expect(result.messages.find((m) => m.code === "BR-DE-26")?.level).toBe("warning");
  });

  it("a document with a fatal-level message is both invalid and rejected", () => {
    const xml = readFileSync(rejectedFixturePath, "utf-8");
    const result = parseKositReport(xml);
    expect(result.valid).toBe(false);
    expect(result.accepted).toBe(false);
    expect(result.messages.map((m) => m.code)).toEqual(
      expect.arrayContaining(["BR-IC-11", "BR-IC-12"]),
    );
  });

  it("the same-day sample this file already uses is both valid and accepted", () => {
    const xml = readFileSync(fixturePath, "utf-8");
    expect(parseKositReport(xml).accepted).toBe(true);
  });

  it("defaults accepted to false when the assessment is absent entirely", () => {
    const xml =
      '<rep:report xmlns:rep="http://www.xoev.de/de/validator/varl/1" valid="true"></rep:report>';
    expect(parseKositReport(xml).accepted).toBe(false);
  });
});
