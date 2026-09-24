import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { COMPOSE_NETWORK_NAME, MEDUSA_IMAGE_NAME, ONE_OFF_LABEL } from "./env.js";

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
 *
 * P-53: a container that boots anyway (the check it tests has regressed) never exits by itself. It is
 * given `timeoutMs`, then removed by name — killing the `docker run` client alone leaves it running — and
 * it carries `ONE_OFF_LABEL`, so `down()` removes one a killed test run left behind (`--remove-orphans`
 * only knows compose's own containers, and a leftover one keeps the network from being removed).
 */
export async function runMedusaOnce(
  envOverrides: Readonly<Record<string, string>>,
  options: { readonly port?: number; readonly timeoutMs?: number } = {},
): Promise<OneOffRunResult> {
  const port = String(options.port ?? 9599);
  const name = `einvoice-e2e-one-off-${port}`;
  const env: Readonly<Record<string, string>> = {
    DATABASE_URL: "postgres://medusa:medusa@postgres:5432/medusa_e2e?sslmode=disable",
    REDIS_URL: "redis://redis:6379",
    PORT: port,
    STORE_CORS: `http://localhost:${port}`,
    ADMIN_CORS: `http://localhost:${port}`,
    AUTH_CORS: `http://localhost:${port}`,
    JWT_SECRET: "einvoice-e2e-test-only",
    COOKIE_SECRET: "einvoice-e2e-test-only",
    EINVOICE_E2E_NPM_INSTALL_FLAGS: process.env["EINVOICE_E2E_NPM_INSTALL_FLAGS"] ?? "",
    ...envOverrides,
  };
  const envArgs = Object.entries(env).flatMap(([key, value]) => ["-e", `${key}=${value}`]);

  try {
    const { stdout, stderr } = await execFileAsync(
      "docker",
      [
        "run",
        "--rm",
        "--name",
        name,
        "--label",
        ONE_OFF_LABEL,
        "--network",
        COMPOSE_NETWORK_NAME,
        ...envArgs,
        `${MEDUSA_IMAGE_NAME}:latest`,
      ],
      { maxBuffer: 16 * 1024 * 1024, timeout: options.timeoutMs ?? 180_000 },
    );
    return { exitCode: 0, output: `${stdout}\n${stderr}` };
  } catch (error) {
    const { code, stdout, stderr } = error as {
      readonly code?: number | string;
      readonly stdout?: string;
      readonly stderr?: string;
    };
    return {
      exitCode: typeof code === "number" ? code : 1,
      output: `${stdout ?? ""}\n${stderr ?? ""}`,
    };
  } finally {
    await execFileAsync("docker", ["rm", "-f", name]).catch(() => {
      // Already gone: it exited and `--rm` removed it, which is the normal case.
    });
  }
}
