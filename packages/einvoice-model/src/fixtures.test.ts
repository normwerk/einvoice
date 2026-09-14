import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { validateModel } from "./index.js";

// fixtures/ lives at the repo root (plan-v0.1 §7), not inside this package —
// shared across einvoice-model (schema validation, here), einvoice-cii
// (golden XML, once T-020 exists), and einvoice-conformance (L1-L5, T-040).
const FIXTURES_DIR = fileURLToPath(new URL("../../../fixtures", import.meta.url));

const fixtureIds = readdirSync(FIXTURES_DIR).filter((name) =>
  statSync(resolve(FIXTURES_DIR, name)).isDirectory(),
);

describe("T-050/T-022 fixtures validate against the generated JSON Schema", () => {
  it("found the expected 6 base + 7 extended fixtures", () => {
    expect(fixtureIds.sort()).toEqual(
      [
        // T-050 base set
        "de-b2b-standard",
        "de-b2b-reverse-charge",
        "de-eu-intracommunity",
        "de-export",
        "de-exempt",
        "de-credit-note",
        // T-022/W7 extended set (plan-v0.1 §7)
        "de-mixed-rates",
        "de-line-discount",
        "de-document-discount",
        "de-shipping-charge",
        "de-special-chars",
        "de-many-lines",
        "de-b2g-leitweg-id",
      ].sort(),
    );
  });

  for (const id of fixtureIds) {
    it(`${id}/input.json is a structurally valid EN 16931 invoice`, () => {
      const input = JSON.parse(readFileSync(resolve(FIXTURES_DIR, id, "input.json"), "utf-8"));
      const result = validateModel(input);
      expect(result.errors).toEqual([]);
      expect(result.valid).toBe(true);
    });
  }
});
