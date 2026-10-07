import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { KositReport } from "../kosit-report.js";
import type { Assessment, DryRunReport } from "./report.js";
import { validateDryRun, xmlFileName, type Validators } from "./validate.js";

const notRun = { status: "not-run" } as const;

function invoice(fulfillmentId: string, outcome: Assessment["outcome"]): Assessment {
  return {
    document: { type: "invoice", orderId: `order_${fulfillmentId}`, fulfillmentId },
    outcome,
  };
}

const REPORT = {
  schemaVersion: 1,
  validation: { status: "not-run", reason: "not-requested" },
  assessments: [
    invoice("ful_valid", { class: "would-issue", profile: "EN16931", validation: notRun }),
    invoice("ful_rejected", { class: "would-issue", profile: "XRECHNUNG", validation: notRun }),
    invoice("ful_missing", { class: "would-issue", profile: "EN16931", validation: notRun }),
    invoice("ful_mustang_fails", { class: "would-issue", profile: "EN16931", validation: notRun }),
    invoice("ful_refused", {
      class: "would-refuse",
      refusal: { code: "NO_VAT_CHARGED", reason: "…", docsUrl: "…" },
    }),
  ],
} as unknown as DryRunReport;

const VALID: KositReport = { valid: true, accepted: true, messages: [] };
const REJECTED: KositReport = {
  valid: false,
  accepted: false,
  messages: [{ level: "error", code: "BR-DE-15", text: "Das Element … Buyer GmbH" }],
};

describe("validateDryRun (T-214)", () => {
  it("puts each validator's verdict on the documents it saw, and leaves the rest as they were", () => {
    const xmlDir = mkdtempSync(path.join(tmpdir(), "dry-run-xml-"));
    for (const id of ["ful_valid", "ful_rejected", "ful_mustang_fails"]) {
      writeFileSync(path.join(xmlDir, xmlFileName(id)), "<xml/>");
    }
    const file = (id: string) => path.join(xmlDir, xmlFileName(id));
    const validators: Validators = {
      tools: [{ name: "kosit-validator", version: "1.6.3", sha256: "x" }],
      kosit: vi.fn(
        () =>
          new Map([
            [file("ful_valid"), VALID],
            [file("ful_rejected"), REJECTED],
            [file("ful_mustang_fails"), VALID],
          ]),
      ),
      mustang: vi.fn((path: string) => {
        if (path === file("ful_mustang_fails")) throw new Error("docker: no space left on device");
        return '<validation><summary status="valid"/></validation>';
      }),
    };

    const validated = validateDryRun(REPORT, xmlDir, validators);

    expect(validated.validation).toEqual({ status: "ran", tools: validators.tools });
    const [valid, rejected, missing, failed, refused] = validated.assessments;
    expect(valid?.outcome).toMatchObject({
      validation: {
        status: "ran",
        verdicts: [
          { tool: "kosit", result: "valid", rules: [] },
          { tool: "mustang", result: "valid", rules: [] },
        ],
      },
    });
    expect(rejected?.outcome).toMatchObject({
      class: "would-issue",
      validation: { verdicts: [{ tool: "kosit", result: "invalid", rules: ["BR-DE-15"] }, {}] },
    });
    expect(missing?.outcome).toMatchObject({ validation: { status: "not-run" } });
    expect(failed?.outcome).toMatchObject({
      class: "tool-error",
      error: { stage: "validate", code: "INTERNAL_ERROR", errorClass: "Error", stack: [] },
    });
    expect(refused).toBe(REPORT.assessments[4]);
    expect(validators.kosit).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(validated)).not.toMatch(/Buyer GmbH|no space left/);
  });
});
