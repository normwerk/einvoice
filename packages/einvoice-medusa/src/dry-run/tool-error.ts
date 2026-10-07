/**
 * T-214: an exception nothing handled, as the dry-run report states it — the defect the run is there to find.
 * Its message is left out (it holds whatever its source put there: a VAT-ID, an address, a query's values —
 * AGENTS.md §5.2), and so is every path outside the `@normwerk` packages, which names the machine's folders.
 * What is left is the error's code and class and the frames in our own code, enough to find the defect and
 * the same in every shop: hence the fingerprint.
 */
import { createHash } from "node:crypto";
import type { StackFrame, ToolError } from "@normwerk/einvoice-conformance" with {
  "resolution-mode": "import",
};
import { errorCodeOf } from "../errors.js";

/** `    at fn (file:line:col)`, `    at file:line:col`, `    at async fn (file:line:col)`. */
const FRAME = /^\s*at (?:async )?(?:(.+?) \()?(.+?):(\d+):(\d+)\)?$/;

/** A path inside a `@normwerk` package, from the package's name on: installed (`node_modules/@normwerk/…`, under
 * pnpm's store too) or in this repository's workspace (`packages/einvoice-…/`). */
function ownPath(file: string): string | undefined {
  const path = file.replace(/^file:\/\//, "").replaceAll("\\", "/");
  const installed = path.lastIndexOf("/@normwerk/");
  if (installed >= 0) return path.slice(installed + 1);
  const workspace = /\/packages\/(einvoice-[a-z0-9-]+)\/(.+)$/.exec(path);
  return workspace === null ? undefined : `@normwerk/${workspace[1]}/${workspace[2]}`;
}

export function stackFramesOf(stack: string | undefined): readonly StackFrame[] {
  const frames: StackFrame[] = [];
  for (const line of (stack ?? "").split("\n")) {
    const match = FRAME.exec(line);
    if (match === null) continue;
    const [, fn, file, row, column] = match;
    const own = file === undefined ? undefined : ownPath(file);
    if (own !== undefined) {
      frames.push({ function: fn ?? "<anonymous>", at: `${own}:${row}:${column}` });
      continue;
    }
    const last = frames.at(-1);
    if (last !== undefined && "outside" in last)
      frames[frames.length - 1] = { outside: last.outside + 1 };
    else frames.push({ outside: 1 });
  }
  return frames;
}

/** The frames of an error's stack, without the `Name: message` V8 puts before them — however many lines the
 * message runs to, and whatever they look like. */
function framesOf(error: Error): string | undefined {
  const header = String(error);
  return error.stack?.startsWith(header) ? error.stack.slice(header.length) : error.stack;
}

export function toolErrorOf(error: unknown, stage: ToolError["stage"]): ToolError {
  const errorClass = error instanceof Error ? error.name : typeof error;
  const stack = stackFramesOf(error instanceof Error ? framesOf(error) : undefined);
  const fingerprint = createHash("sha256")
    .update([errorClass, ...stack.map((frame) => JSON.stringify(frame))].join("\n"))
    .digest("hex")
    .slice(0, 12);
  return { stage, code: errorCodeOf(error).code, errorClass, stack, fingerprint };
}
