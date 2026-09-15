import { coverageConfigDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
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
