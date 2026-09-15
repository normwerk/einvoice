import { coverageConfigDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      exclude: [
        ...coverageConfigDefaults.exclude,
        // Serialization-plan interfaces/type aliases only (ADR-004) — no runtime logic; the actual plan
        // *data* (`src/generated/plan.ts`) and the interpreter that walks it (`serialize.ts`) are both
        // still fully in scope.
        "src/plan-types.ts",
      ],
      thresholds: {
        statements: 85,
        lines: 85,
        functions: 85,
        branches: 85,
      },
    },
  },
});
