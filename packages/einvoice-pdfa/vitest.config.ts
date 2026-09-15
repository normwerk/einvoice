import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      thresholds: {
        statements: 85,
        lines: 85,
        functions: 85,
        branches: 85,
      },
    },
  },
});
