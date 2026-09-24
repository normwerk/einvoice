/**
 * Single source of truth for the stand's ports/credentials — read by the harness (docker compose env),
 * by scenario tests (to build API URLs), and by anything asserting against the fixed VAT-ID/clock. Values
 * mirror `docker/compose.e2e.yml`'s own `${VAR:-default}` defaults; overriding one here and not there (or
 * vice versa) would silently talk past the stand, so this is the only place either side should read from.
 */
export const POSTGRES_PORT = Number(process.env["EINVOICE_E2E_POSTGRES_PORT"] ?? 55432);
export const VERDACCIO_PORT = Number(process.env["EINVOICE_E2E_VERDACCIO_PORT"] ?? 4873);
export const MEDUSA_PORT = Number(process.env["EINVOICE_E2E_MEDUSA_PORT"] ?? 9500);

export const VERDACCIO_URL = `http://localhost:${VERDACCIO_PORT}`;
export const MEDUSA_URL = `http://localhost:${MEDUSA_PORT}`;

export const ADMIN_EMAIL = "admin@einvoice-e2e.example";
export const ADMIN_PASSWORD = "supersecret";

/** `docker/compose.e2e.yml`'s own `name:` — both its container names (`<project>-<service>-1`) and its
 * default network (`<project>_default`) derive from this. */
export const COMPOSE_PROJECT_NAME = "einvoice-e2e";
export const MEDUSA_CONTAINER_NAME = `${COMPOSE_PROJECT_NAME}-medusa-1`;
export const COMPOSE_NETWORK_NAME = `${COMPOSE_PROJECT_NAME}_default`;
export const MEDUSA_IMAGE_NAME = `${COMPOSE_PROJECT_NAME}-medusa`;
/** Marks the disposable containers `run-medusa-once.ts` starts outside compose, for `down()` to find. */
export const ONE_OFF_LABEL = `${COMPOSE_PROJECT_NAME}.one-off=true`;

/** Must match `medusa-config.ts`'s own read of the same env var — see that file's doc comment. */
export const VALID_VAT_ID = process.env["EINVOICE_E2E_VALID_VAT_ID"] ?? "FR40303265045";

/** Must match `medusa-config.ts`'s own read of the same env var — a VAT-ID the stand's verifier answers
 * "unavailable" for, as VIES does when a member state's service is down (S14). */
export const UNAVAILABLE_VAT_ID = process.env["EINVOICE_E2E_UNAVAILABLE_VAT_ID"] ?? "FR99999999999";

/** Must match `medusa-config.ts`'s own read of the same env var — a fixed invoice date for every document
 * this stand produces (plan-e2e.md §5 rule 5). */
export const FIXED_NOW = process.env["EINVOICE_E2E_NOW"] ?? "2026-01-15T10:00:00.000Z";

/**
 * All six packages this repo actually publishes to npm (verified against each `package.json`:
 * `einvoice-ubl` is the one package marked `"private": true` and excluded from `.changeset/config.json`'s
 * own `ignore` reasoning — "until it has a real serializer" — the other six, `einvoice-conformance`
 * included, all carry a real `publishConfig`). The stand's Verdaccio publish step and the tarball-contents
 * check (plan-e2e.md §4/§8) both target this exact list; the app installed into the stand
 * (`e2e/app/package.json`) only *depends on* five of them — `einvoice-conformance` is dev tooling, "never a
 * runtime dependency of anything shipped" (its own package.json description).
 */
export const PUBLISHED_PACKAGE_DIRS = [
  "einvoice-model",
  "einvoice-commerce",
  "einvoice-cii",
  "einvoice-pdfa",
  "einvoice-medusa",
  "einvoice-conformance",
] as const;
