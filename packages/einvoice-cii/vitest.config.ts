import { configDefaults, coverageConfigDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The compiled copies of the tests in dist/ are not run: vitest 4 no longer excludes dist/ itself.
    exclude: [...configDefaults.exclude, "**/dist/**"],
    coverage: {
      // Every source file counts, loaded by a test or not — vitest 4 reports only loaded files by default.
      include: ["src/**/*.{ts,tsx,mts}"],
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
