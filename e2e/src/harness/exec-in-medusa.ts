import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { MEDUSA_CONTAINER_NAME } from "./env.js";

const execFileAsync = promisify(execFile);

/** The plugin's subscribers, as the stand's `medusa` container has them installed. */
const SUBSCRIBERS_DIR =
  "/app/node_modules/@normwerk/einvoice-medusa/.medusa/server/src/subscribers";

/**
 * Delivers an event a second time to one of the plugin's subscribers, inside the running `medusa` container
 * via `medusa exec` — there is no HTTP endpoint for "redeliver event X". `medusa exec` boots a second app
 * instance against the same database, with the plugin's module and its UNIQUE-index guard (D-31) loaded.
 *
 * The subscriber is called directly and awaited, with the same payload the event carries. An earlier version
 * emitted the event on that instance's in-memory event bus instead, which starts the subscriber and returns
 * without waiting for it (P-53): the test then counted documents while the second delivery could still be
 * running, or had been cut off when `medusa exec` exited, and passed either way. Now a failing redelivery
 * fails `medusa exec`, and the count is taken after it has finished.
 */
export async function redeliverEvent(
  subscriber: "invoice-on-fulfillment-created" | "credit-note-on-payment-refunded",
  eventName: string,
  data: Readonly<Record<string, unknown>>,
): Promise<void> {
  const workDir = await mkdtemp(path.join(tmpdir(), "einvoice-e2e-redeliver-"));
  const scriptPath = path.join(workDir, "redeliver.mjs");
  await writeFile(
    scriptPath,
    [
      'import { createRequire } from "node:module";',
      "const require = createRequire(import.meta.url);",
      `const { default: handler } = require(${JSON.stringify(`${SUBSCRIBERS_DIR}/${subscriber}.js`)});`,
      "export default async function ({ container }) {",
      `  await handler({ event: { name: ${JSON.stringify(eventName)}, data: ${JSON.stringify(data)} }, container, pluginOptions: {} });`,
      "}",
      "",
    ].join("\n"),
  );

  const containerPath = "/app/.e2e-redeliver.mjs";
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
