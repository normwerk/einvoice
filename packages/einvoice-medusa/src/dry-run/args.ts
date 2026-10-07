/**
 * T-214: the dry run's arguments, as `medusa exec <script> [args..]` hands them over — `key=value` words, so
 * that Medusa's own option parser leaves them alone.
 */
import type { DryRunOrderSelection } from "./run.js";

export const DRY_RUN_USAGE =
  "Usage: npx medusa exec ./node_modules/@normwerk/einvoice-medusa/.medusa/server/src/scripts/einvoice-dry-run.js " +
  "from=YYYY-MM-DD to=YYYY-MM-DD [out=einvoice-dry-run] — or orders=<order id>,<order id> instead of from and to.";

export interface DryRunArgs {
  readonly selection: DryRunOrderSelection;
  /** The folder the report and the XML go to, relative to the shop's root. */
  readonly out: string;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function parseDryRunArgs(args: readonly string[]): DryRunArgs {
  const values = new Map<string, string>();
  for (const arg of args) {
    const match = /^(from|to|orders|out)=(.+)$/.exec(arg);
    if (match === null) throw new Error(`Unknown argument "${arg}". ${DRY_RUN_USAGE}`);
    values.set(match[1] ?? "", match[2] ?? "");
  }
  const from = values.get("from");
  const to = values.get("to");
  const orders = values.get("orders");
  const out = values.get("out") ?? "einvoice-dry-run";
  if (orders !== undefined) {
    if (from !== undefined || to !== undefined) {
      throw new Error(`Give either orders or from and to, not both. ${DRY_RUN_USAGE}`);
    }
    const ids = orders
      .split(",")
      .map((id) => id.trim())
      .filter((id) => id !== "");
    if (ids.length === 0) throw new Error(`orders= names no order. ${DRY_RUN_USAGE}`);
    return { selection: { kind: "orders", ids }, out };
  }
  if (from === undefined || to === undefined || !DATE.test(from) || !DATE.test(to)) {
    throw new Error(`Give the period as from=YYYY-MM-DD to=YYYY-MM-DD. ${DRY_RUN_USAGE}`);
  }
  if (from > to) throw new Error(`The period ends before it starts: ${from} to ${to}.`);
  return { selection: { kind: "period", from, to }, out };
}
