import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { MEDUSA_CONTAINER_NAME } from "./env.js";

const execFileAsync = promisify(execFile);

/**
 * Re-emits a real Medusa event from inside the running `medusa` container, via `medusa exec` — the only
 * way to trigger the exact idempotency guard the plugin relies on (`recordDocumentIfAbsent`'s UNIQUE
 * index, D-31) from outside the process. There is no HTTP endpoint for "redeliver event X" (Medusa doesn't
 * expose one), and this stand's own event bus is the in-memory local one (no Redis-backed redelivery to
 * provoke instead) — verified against a real run: this genuinely runs the same subscriber code a second
 * time with the same payload, which is the actual thing plan-e2e.md §4's idempotency check needs proven,
 * not a mock of it.
 */
export async function reemitEvent(
  eventName: string,
  data: Readonly<Record<string, unknown>>,
): Promise<void> {
  const workDir = await mkdtemp(path.join(tmpdir(), "einvoice-e2e-reemit-"));
  const scriptPath = path.join(workDir, "reemit.mjs");
  await writeFile(
    scriptPath,
    [
      'import { Modules } from "@medusajs/framework/utils";',
      "export default async function ({ container }) {",
      "  const eventBus = container.resolve(Modules.EVENT_BUS);",
      `  await eventBus.emit({ name: ${JSON.stringify(eventName)}, data: ${JSON.stringify(data)} });`,
      "}",
      "",
    ].join("\n"),
  );

  const containerPath = "/app/.e2e-reemit.mjs";
  try {
    await execFileAsync("docker", ["cp", scriptPath, `${MEDUSA_CONTAINER_NAME}:${containerPath}`]);
    await execFileAsync("docker", [
      "exec",
      MEDUSA_CONTAINER_NAME,
      "sh",
      "-c",
      `export PATH="/app/node_modules/.bin:$PATH" && medusa exec ${containerPath}`,
    ]);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}
