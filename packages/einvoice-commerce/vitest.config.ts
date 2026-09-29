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
        // `index.ts` is a pure barrel re-export (no logic of its own — everything it re-exports is
        // already covered where it's actually defined). `types.ts` is interfaces/type aliases only.
        "src/index.ts",
        "src/types.ts",
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
