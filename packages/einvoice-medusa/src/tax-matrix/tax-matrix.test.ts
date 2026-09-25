/**
 * T-117: fast (no Docker) proof of every matrix cell's category/error axes. `@normwerk/einvoice-commerce`
 * is ESM-only while this package compiles to CommonJS (`tsconfig.json`'s `module: "Node16"`) — a static
 * import would fail typecheck the same way it would in the shipped plugin (`order-to-commerce-invoice-input
 * .ts`'s own doc comment), so this loads it dynamically once in `beforeAll`, the same pattern the real
 * subscribers use. The Docker gate (`pnpm conformance:tax-matrix`) covers the remaining, non-fast half of
 * the acceptance bar: that every "validated" cell's XML really passes the real KoSIT validator.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { loadTaxMatrixCells } from "./load-cells.js";
import { runTaxMatrixCell, type TaxMatrixDeps } from "./run-cell.js";
import type { BuildAxisOutcome, ProfileAxisOutcome } from "./types.js";

function assertAxis(
  actual: BuildAxisOutcome | ProfileAxisOutcome,
  expected: BuildAxisOutcome | ProfileAxisOutcome,
): void {
  if (expected.kind === "ok") {
    expect(actual).toEqual(expected);
    return;
  }
  expect(actual.kind, JSON.stringify(actual)).toBe("error");
  if (actual.kind === "error") {
    expect(actual.errorClass).toBe(expected.errorClass);
    expect(actual.errorCode).toBe(expected.errorCode);
    if (expected.messageIncludes !== undefined) {
      expect(actual.messageIncludes).toContain(expected.messageIncludes);
    }
  }
}

describe("tax matrix", () => {
  let deps: TaxMatrixDeps;

  beforeAll(async () => {
    const commerce = await import("@normwerk/einvoice-commerce");
    deps = { selectProfile: commerce.selectProfile, buildInvoice: commerce.buildInvoice };
  });

  const cells = loadTaxMatrixCells();

  it("has at least one cell", () => {
    expect(cells.length).toBeGreaterThan(0);
  });

  for (const cell of cells) {
    describe(cell.id, () => {
      it(`build axis matches ${cell.expected.specRow ?? "its expectation"}`, () => {
        const result = runTaxMatrixCell(cell, deps);
        assertAxis(result.build, cell.expected.build);
      });

      it("profile axis matches its expectation", () => {
        const result = runTaxMatrixCell(cell, deps);
        assertAxis(result.profile, cell.expected.profile);
      });
    });
  }
});
