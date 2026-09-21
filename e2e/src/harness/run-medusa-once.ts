import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { COMPOSE_NETWORK_NAME, MEDUSA_IMAGE_NAME } from "./env.js";

const execFileAsync = promisify(execFile);

export interface OneOffRunResult {
  readonly exitCode: number;
  readonly output: string;
}

/**
 * Runs a single, disposable `medusa` container against the shared stand's already-running Postgres/Redis
 * (by service name, over the compose network — `docker/compose.e2e.yml`'s own `name:`), with `envOverrides`
 * layered on top of the same defaults `compose.e2e.yml` itself uses. For a boot-time negative check
 * (`incomplete-config.test.ts`): the container is expected to exit non-zero on its own before ever
 * answering HTTP, so this never needs a port mapping or a healthcheck, just the exit code and logs.
 */
export async function runMedusaOnce(
  envOverrides: Readonly<Record<string, string>>,
  options: { readonly port?: number } = {},
): Promise<OneOffRunResult> {
  const port = String(options.port ?? 9599);
  const env: Readonly<Record<string, string>> = {
    DATABASE_URL: "postgres://medusa:medusa@postgres:5432/medusa_e2e?sslmode=disable",
    REDIS_URL: "redis://redis:6379",
    PORT: port,
    STORE_CORS: `http://localhost:${port}`,
    ADMIN_CORS: `http://localhost:${port}`,
    AUTH_CORS: `http://localhost:${port}`,
    JWT_SECRET: "einvoice-e2e-test-only",
    COOKIE_SECRET: "einvoice-e2e-test-only",
    ...envOverrides,
  };
  const envArgs = Object.entries(env).flatMap(([key, value]) => ["-e", `${key}=${value}`]);

  try {
    const { stdout, stderr } = await execFileAsync(
      "docker",
      ["run", "--rm", "--network", COMPOSE_NETWORK_NAME, ...envArgs, `${MEDUSA_IMAGE_NAME}:latest`],
      { maxBuffer: 16 * 1024 * 1024 },
    );
    return { exitCode: 0, output: `${stdout}\n${stderr}` };
  } catch (error) {
    const { code, stdout, stderr } = error as {
      readonly code?: number;
      readonly stdout?: string;
      readonly stderr?: string;
    };
    return { exitCode: code ?? 1, output: `${stdout ?? ""}\n${stderr ?? ""}` };
  }
}
