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
        // Generated, pure `type`/`interface`/union declarations (AGENTS.md §9) — no runtime logic to
        // exercise; every field they declare is already exercised indirectly wherever the real logic
        // (`validate.ts`, `index.ts`) uses it. Not `json-schema.ts`, which stays in scope: it's generated
        // data too, but `validate.ts`'s own tests already exercise it for real (ajv actually compiling and
        // running it), so excluding it would just hide that it's covered rather than reflect a real gap.
        "src/generated/codelists.ts",
        "src/generated/primitives.ts",
        "src/generated/types.ts",
      ],
      thresholds: {
        statements: 85,
        lines: 85,
        functions: 60,
        branches: 60,
      },
    },
  },
});
