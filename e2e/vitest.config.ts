import { BaseSequencer, type TestSpecification } from "vitest/node";
import { defineConfig } from "vitest/config";

/** T-214: the dry run reads every order the other scenarios placed — it runs last. */
class DryRunLastSequencer extends BaseSequencer {
  override async sort(files: TestSpecification[]): Promise<TestSpecification[]> {
    const sorted = await super.sort(files);
    const isDryRun = (file: TestSpecification) => file.moduleId.endsWith("/dry-run.test.ts");
    return [...sorted.filter((file) => !isDryRun(file)), ...sorted.filter(isDryRun)];
  }
}

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
    sequence: { sequencer: DryRunLastSequencer },
  },
});
