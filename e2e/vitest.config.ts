import { defineConfig } from "vitest/config";

// T-078: real Docker, a real Medusa boot, and real HTTP round-trips — none of this is fast, and it's all
// against one shared stand (globalSetup brings it up once), so scenario files never run concurrently
// against each other (plan-e2e.md §5 rule 4). Not part of the root `vitest.config.ts` projects (packages/* only)
// or of `pnpm -r test`/`pnpm test` (package.json has no `test` script) — this only runs via `pnpm e2e`.
export default defineConfig({
  test: {
    globalSetup: "./src/harness/global-setup.ts",
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 300_000,
  },
});
