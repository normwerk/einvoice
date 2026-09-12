import { defineWorkspace } from "vitest/config";

// One entry per workspace package. Each package also runs its own tests
// standalone via its `test` script (`pnpm -r test`); this file additionally
// lets `vitest` run all of them from the repo root in one process.
export default defineWorkspace(["packages/*"]);
