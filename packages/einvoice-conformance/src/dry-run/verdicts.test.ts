import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseKositReport } from "../kosit-report.js";
import { kositVerdict, mustangVerdict } from "./verdicts.js";

const fixture = (name: string) =>
  parseKositReport(readFileSync(new URL(`../__fixtures__/${name}`, import.meta.url), "utf8"));

describe("kositVerdict (T-214)", () => {
  it("is valid with no rule for a valid document, even with an information-level message", () => {
    expect(kositVerdict(fixture("kosit-report-sample.xml"))).toEqual({
      tool: "kosit",
      result: "valid",
      rules: [],
    });
  });

  it("names the rules of a rejected document, and of an accepted one with warnings", () => {
    expect(kositVerdict(fixture("kosit-report-sample-rejected.xml"))).toMatchObject({
      result: "invalid",
      rules: expect.arrayContaining([expect.stringMatching(/^BR-/)]),
    });
    expect(kositVerdict(fixture("kosit-report-sample-warning-accepted.xml"))).toMatchObject({
      result: "warnings",
      rules: ["BR-DE-26"],
    });
  });
});

describe("mustangVerdict (T-214)", () => {
  const report = (messages: string, status: string) =>
    `<validation><xml><messages>${messages}</messages><summary status="${status}"/></xml>` +
    `<messages></messages><summary status="${status}"/></validation>`;

  it("names the rules of its errors and warnings by id, never by text, and ignores notices", () => {
    const output = report(
      '<error type="24" location="/x" criterion="y">[BR-CO-15]-Invoice total amount … [ID BR-CO-15] from x.xslt)</error>' +
        '<warning type="26">[BR-DE-21] Das Element … Buyer GmbH</warning>' +
        '<notice type="27">[BR-DE-TMP-32] Eine Rechnung sollte … [ID BR-DE-TMP-32]</notice>' +
        '<error type="18">Schema validation failed: Musterstraße 1</error>',
      "invalid",
    );

    expect(mustangVerdict(output)).toEqual({
      tool: "mustang",
      result: "invalid",
      rules: ["BR-CO-15", "type 18", "BR-DE-21"],
    });
  });

  it("is valid, or valid with warnings, by its summary and its warnings", () => {
    expect(mustangVerdict(report("", "valid"))).toEqual({
      tool: "mustang",
      result: "valid",
      rules: [],
    });
    expect(
      mustangVerdict(report('<warning type="26">[BR-DE-21] …</warning>', "valid")),
    ).toMatchObject({
      result: "warnings",
      rules: ["BR-DE-21"],
    });
  });
});
