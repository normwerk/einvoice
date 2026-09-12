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
});
