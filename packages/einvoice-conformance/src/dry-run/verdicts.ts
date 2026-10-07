/**
 * T-214: one validator's verdict on one document, as the dry-run report states it — the result and the ids of
 * the rules that fired at warning level or above. Never a message's text or its location: the text can quote
 * the document, and the report carries no personal data (`report.ts`).
 */
import type { KositReport } from "../kosit-report.js";
import type { ValidatorVerdict } from "./report.js";

const KOSIT_LEVELS: ReadonlySet<string> = new Set(["warning", "error", "fatal"]);

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

/** KoSIT's strict `valid`, its `accepted` with warnings, or rejected. Information-level messages
 * (`BR-DE-TMP-32`) fire no rule here, as they fail no gate in this repository. */
export function kositVerdict({ valid, accepted, messages }: KositReport): ValidatorVerdict {
  return {
    tool: "kosit",
    result: valid ? "valid" : accepted ? "warnings" : "invalid",
    rules: unique(
      messages
        .filter(({ level, code }) => KOSIT_LEVELS.has(level) && code !== null)
        .map(({ code }) => code ?? ""),
    ),
  };
}

/** The rule ids of Mustang's `<error>` or `<warning>` elements: `[ID BR-CO-15]`, else a leading
 * `[BR-CO-15]`, else the message's type number. */
function mustangRules(output: string, tag: "error" | "warning"): string[] {
  return [...output.matchAll(new RegExp(`<${tag}\\b([^>]*)>([\\s\\S]*?)</${tag}>`, "g"))].map(
    ([, attributes = "", body = ""]) =>
      /\[ID ([^\]\s]+)\]/.exec(body)?.[1] ??
      /^\s*\[([A-Z][A-Z0-9-]*)\]/.exec(body)?.[1] ??
      `type ${/\btype="([^"]*)"/.exec(attributes)?.[1] ?? "unknown"}`,
  );
}

/** Mustang's `--action validate` report: its last `<summary status>` and the rules its errors and warnings
 * name. Notices fail nothing. */
export function mustangVerdict(output: string): ValidatorVerdict {
  const status = [...output.matchAll(/<summary status="([a-z]+)"\s*\/>/g)].at(-1)?.[1];
  const errors = mustangRules(output, "error");
  const warnings = mustangRules(output, "warning");
  return {
    tool: "mustang",
    result:
      status !== "valid" || errors.length > 0
        ? "invalid"
        : warnings.length > 0
          ? "warnings"
          : "valid",
    rules: unique([...errors, ...warnings]),
  };
}
