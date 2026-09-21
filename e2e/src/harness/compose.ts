import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import path from "node:path";

const execFileAsync = promisify(execFile);

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const COMPOSE_FILE = path.join(HERE, "..", "..", "docker", "compose.e2e.yml");

async function compose(args: readonly string[]): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync("docker", ["compose", "-f", COMPOSE_FILE, ...args], {
    maxBuffer: 64 * 1024 * 1024,
  });
}

/** Phase 1 of `plan-e2e.md`'s two-phase bring-up (docker/compose.e2e.yml's own header comment): the three
 * services `medusa`'s own image build depends on. */
export async function upBase(): Promise<void> {
  await compose(["up", "-d", "--wait", "postgres", "redis", "verdaccio"]);
}

/** Phase 2: build (picking up whatever the harness just published to Verdaccio) and start `medusa`. A real
 * `npm install` of the whole app is the slow part (Dockerfile's own doc comment) — 600s bounds a genuinely
 * broken image/network without making every ordinary run wait needlessly long. */
export async function upMedusa(): Promise<void> {
  await compose(["up", "-d", "--wait", "--wait-timeout", "600", "--build", "medusa"]);
}

export async function down(): Promise<void> {
  await compose(["down", "-v", "--remove-orphans"]);
}

export async function logs(service: string): Promise<string> {
  const { stdout } = await compose(["logs", "--no-color", service]);
  return stdout;
}
