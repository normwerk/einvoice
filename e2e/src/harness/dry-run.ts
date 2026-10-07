import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { COMPOSE_PROJECT_NAME, MEDUSA_CONTAINER_NAME } from "./env.js";

const execFileAsync = promisify(execFile);

const POSTGRES_CONTAINER = `${COMPOSE_PROJECT_NAME}-postgres-1`;
const DB_USER = process.env["EINVOICE_E2E_POSTGRES_USER"] ?? "medusa";
const DB_PASSWORD = process.env["EINVOICE_E2E_POSTGRES_PASSWORD"] ?? "medusa";
export const STAND_DB = process.env["EINVOICE_E2E_POSTGRES_DB"] ?? "medusa_e2e";
/** T-214: the copy of the stand's database a dry run reads — a staging copy, as a merchant runs it on. */
export const COPY_DB = "medusa_dry_run";

const SCRIPT =
  "/app/node_modules/@normwerk/einvoice-medusa/.medusa/server/src/scripts/einvoice-dry-run.js";
const CONTAINER_OUT = "/tmp/einvoice-dry-run";
const MAX_BUFFER = 256 * 1024 * 1024;

async function inPostgres(command: string): Promise<string> {
  const { stdout } = await execFileAsync(
    "docker",
    ["exec", POSTGRES_CONTAINER, "sh", "-c", command],
    { maxBuffer: MAX_BUFFER },
  );
  return stdout;
}

/** Rows of a query, each a tab-separated line split into its columns. */
export async function queryRows(database: string, sql: string): Promise<string[][]> {
  const output = await inPostgres(
    `psql -U ${DB_USER} -d ${database} -At -F "$(printf '\\t')" -c ${JSON.stringify(sql)}`,
  );
  return output
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => line.split("\t"));
}

/** A fresh copy of the stand's database, with every document and refusal of the plugin removed: the shop as it
 * was before the plugin issued anything — what a merchant checking their store before installing it has. */
export async function copyStandDatabase(): Promise<void> {
  await inPostgres(
    `dropdb -U ${DB_USER} --if-exists ${COPY_DB} && createdb -U ${DB_USER} ${COPY_DB} && ` +
      `pg_dump -U ${DB_USER} ${STAND_DB} | psql -q -U ${DB_USER} ${COPY_DB} > /dev/null`,
  );
  await inPostgres(
    `psql -U ${DB_USER} -d ${COPY_DB} -q -c "delete from einvoice_document; delete from einvoice_refusal;"`,
  );
}

/** SHA-256 of every row of a database. pg_dump's `\restrict` lines carry a key it draws anew each time. */
export async function databaseDigest(database: string): Promise<string> {
  const dump = await inPostgres(`pg_dump -U ${DB_USER} --data-only ${database}`);
  const rows = dump
    .split("\n")
    .filter((line) => !/^\\(un)?restrict /.test(line))
    .join("\n");
  return createHash("sha256").update(rows).digest("hex");
}

export interface DryRunResult {
  /** The folder on the host the run wrote: `report.json` and `xml/`. */
  readonly folder: string;
  /** The files the shop's File Module holds before and after the run. */
  readonly filesBefore: number;
  readonly filesAfter: number;
}

/** Runs the plugin's dry run inside the stand's `medusa` container — `medusa exec`, as a merchant does — against
 * `COPY_DB`, and copies the folder it writes out to the host. */
export async function runDryRun(args: readonly string[]): Promise<DryRunResult> {
  const databaseUrl = `postgres://${DB_USER}:${DB_PASSWORD}@postgres:5432/${COPY_DB}?sslmode=disable`;
  const countFiles = "find /app/static -type f 2>/dev/null | wc -l";
  const { stdout } = await execFileAsync(
    "docker",
    [
      "exec",
      "-e",
      `DATABASE_URL=${databaseUrl}`,
      MEDUSA_CONTAINER_NAME,
      "sh",
      "-c",
      `export PATH="/app/node_modules/.bin:$PATH" && rm -rf ${CONTAINER_OUT} && before=$(${countFiles}) && ` +
        `medusa exec ${SCRIPT} ${args.join(" ")} out=${CONTAINER_OUT} > /dev/null && ` +
        `echo "files $before $(${countFiles})"`,
    ],
    { maxBuffer: MAX_BUFFER },
  );
  const [, before = "", after = ""] = /files\s+(\d+)\s+(\d+)/.exec(stdout) ?? [];
  const host = await mkdtemp(path.join(tmpdir(), "einvoice-e2e-dry-run-"));
  await execFileAsync("docker", ["cp", `${MEDUSA_CONTAINER_NAME}:${CONTAINER_OUT}`, host]);
  return {
    folder: path.join(host, path.basename(CONTAINER_OUT)),
    filesBefore: Number(before),
    filesAfter: Number(after),
  };
}
