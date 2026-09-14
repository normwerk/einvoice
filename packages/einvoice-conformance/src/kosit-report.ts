/**
 * Minimal parser for the KoSIT Validator's VARL report XML
 * (`http://www.xoev.de/de/validator/varl/1`). No XML library dependency
 * yet — the fields we need are a handful of attributes and simple text
 * nodes, so a couple of regexes are more honest than pulling in a parser
 * for one file at spike-C stage. Revisit once `einvoice-cii` needs a real
 * XML parser (plan-v0.1 §4.2) and this can share it.
 */

export interface KositMessage {
  readonly level: string;
  readonly code: string | null;
  readonly text: string;
}

export interface KositReport {
  /** The report's own top-level `valid` attribute: strictly "zero warnings or errors at any validation
   * step" — an "information"-level message alone leaves this `true`, but a single `warning` already flips
   * it to `false`, even when KoSIT's own business verdict (`accepted`) is to accept and process the
   * document (found while writing docs/tax-semantics.md row 11's corrected-invoice example, T-052: a
   * document with only a `BR-DE-26` warning has `valid: false` here but `accepted: true`). Every existing
   * conformance gate in this repo (`pnpm conformance:fixtures`, `conformance:commerce`, …) asserts this
   * field, matching this project's deliberately strict bar for "green" — not `accepted`. */
  readonly valid: boolean;
  /** KoSIT's own recommendation (`<rep:assessment><rep:accept>` vs `<rep:reject>`) — what the CLI's own
   * human-readable "Acceptable: N, Rejected: M" summary reflects. A document can be `accepted: true` with
   * `valid: false` (warnings only); it is never `accepted: true` with a `valid: false` caused by a `error`-
   * or `fatal`-level message — only `warning`/`information` ones leave `accepted` true. */
  readonly accepted: boolean;
  readonly messages: readonly KositMessage[];
}

/** BT: parse the top-level `valid` attribute, the accept/reject assessment, and every `<rep:message>` node. */
export function parseKositReport(xml: string): KositReport {
  const validMatch = /<rep:report\b[^>]*\bvalid="(true|false)"/.exec(xml);
  const valid = validMatch?.[1] === "true";

  // <rep:assessment><rep:accept>…</rep:accept></rep:assessment> vs …<rep:reject>… — absent entirely (e.g.
  // a hand-built XML fixture in a unit test) defaults to false rather than assuming acceptance.
  const accepted = /<rep:assessment>\s*<rep:accept\b/.test(xml);

  const messages: KositMessage[] = [];
  const messageRe = /<rep:message\b([^>]*)>([\s\S]*?)<\/rep:message>/g;
  let match: RegExpExecArray | null;
  while ((match = messageRe.exec(xml)) !== null) {
    const attrs = match[1] ?? "";
    const level = /\blevel="([^"]*)"/.exec(attrs)?.[1] ?? "unknown";
    const code = /\bcode="([^"]*)"/.exec(attrs)?.[1] ?? null;
    const text = (match[2] ?? "").replace(/\s+/g, " ").trim();
    messages.push({ level, code, text });
  }

  return { valid, accepted, messages };
}
