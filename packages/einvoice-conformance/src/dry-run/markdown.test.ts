import { describe, expect, it } from "vitest";
import { exampleReport } from "./__fixtures__/example-report.js";
import { renderDryRunMarkdown } from "./markdown.js";
import type { Assessment, DryRunReport } from "./report.js";

function withoutValidation({ document, outcome }: Assessment): Assessment {
  return outcome.class === "would-issue" || outcome.class === "would-issue-with-notice"
    ? { document, outcome: { ...outcome, validation: { status: "not-run" } } }
    : { document, outcome };
}

describe("dry-run report", () => {
  it("writes the example report as JSON", async () => {
    await expect(`${JSON.stringify(exampleReport, null, 2)}\n`).toMatchFileSnapshot(
      "./__fixtures__/example-report.json",
    );
  });

  it("renders the example report as Markdown", async () => {
    await expect(renderDryRunMarkdown(exampleReport)).toMatchFileSnapshot(
      "./__fixtures__/example-report.md",
    );
  });

  it("says the documents were not validated when the validators did not run, never that they are valid", () => {
    const report: DryRunReport = {
      ...exampleReport,
      validation: { status: "not-run", reason: "docker-unavailable" },
      assessments: exampleReport.assessments.map(withoutValidation),
    };
    const markdown = renderDryRunMarkdown(report);

    expect(markdown).toContain("Not validated: Docker is not available");
    expect(markdown).not.toMatch(/\d+ valid/);
    expect(markdown).not.toContain("BR-CO-15");
  });
});
