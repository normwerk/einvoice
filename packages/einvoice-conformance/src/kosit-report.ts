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
  readonly valid: boolean;
  readonly messages: readonly KositMessage[];
}

/** BT: parse the top-level `valid` attribute and every `<rep:message>` node. */
export function parseKositReport(xml: string): KositReport {
  const validMatch = /<rep:report\b[^>]*\bvalid="(true|false)"/.exec(xml);
  const valid = validMatch?.[1] === "true";

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

  return { valid, messages };
}
