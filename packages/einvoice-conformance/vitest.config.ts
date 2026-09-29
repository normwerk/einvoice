import { configDefaults, defineConfig } from "vitest/config";

// Its own config, so that the repository root's (the projects list) is not picked up instead.
export default defineConfig({
  test: {
    // The compiled copies of the tests in dist/ are not run: vitest 4 no longer excludes dist/ itself.
    exclude: [...configDefaults.exclude, "**/dist/**"],
    coverage: {
      include: ["src/**/*.{ts,tsx,mts}"],
    },
  },
});
