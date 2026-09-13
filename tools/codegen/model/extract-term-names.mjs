/**
 * Extracts candidate BT/BG official-name mentions directly from the vendored
 * EN 16931 CII Schematron (artifacts/cii-d16b/schematron/, EUPL-1.2 —
 * artifacts/MANIFEST.json). This is the audit trail behind terms.mjs: every
 * curated term with `verified: "extraction"` must have its name appear here
 * for the code it claims, or `generate.mjs` refuses to emit (plan-v0.1 §5 /
 * ADR-002 — generated code traces back to an artifact, not to memory).
 *
 * Rule text conventionally reads "...shall contain the Seller name (BT-27)."
 * — the pattern below captures the noun phrase immediately preceded by
 * "the"/"a"/"an" and immediately followed by "(BT-NN)" or "(BG-NN)".
 */
import { readFileSync } from "node:fs";

// A term name can legitimately capitalize a recurring noun *anywhere* in
// the phrase, not just at the start ("Preceding Invoice reference", "Sum
// of Invoice line net amount") — so continuation words can't be
// restricted by case at all without also losing those. What actually
// separates a term name from the surrounding sentence in this ruleset's
// prose is a small, closed set of grammatical filler words ("shall",
// "must", "have", "is", ...) that never appear *inside* a BT/BG name —
// blocking those, rather than restricting by case, is what stops the
// match at the sentence's real verb instead of running on into it.
const STOPWORDS = new Set([
  "shall",
  "must",
  "should",
  "may",
  "might",
  "will",
  "would",
  "can",
  "could",
  "have",
  "has",
  "had",
  "be",
  "is",
  "are",
  "was",
  "were",
  "been",
  "being",
  "contain",
  "only",
  "not",
  "no",
  "none",
  "both",
  "either",
  "neither",
  "also",
  "then",
  "if",
  "when",
  "where",
  "that",
  "which",
  "who",
  "this",
  "these",
  "those",
  "given",
  "used",
  "present",
  "specified",
  "applicable",
  "provided",
  "exist",
  "at",
  "least",
]);
const CONTINUATION_WORD = `(?!(?:${[...STOPWORDS].join("|")})\\b)[A-Za-z][A-Za-z0-9/'-]*`;
// Same idea for the phrase's own first word: a capitalized conjunction
// ("If Invoice line period (BG-26) is used...") is not part of the term
// name either, even though it satisfies the plain "starts with a capital
// letter" anchor.
const LEADING_STOPWORDS = ["If", "When", "Where", "Unless", "Since", "As", "While"];
const PHRASE_START = `(?!(?:${LEADING_STOPWORDS.join("|")})\\b)[A-Z][A-Za-z0-9/'-]*`;
const PHRASE = `${PHRASE_START}(?:\\s+${CONTINUATION_WORD}){0,6}`;

// Primary: an article (the/a/an/each, in either sentence-initial capitalized
// form or lowercase mid-sentence form) immediately before the phrase. Case
// alternatives are spelled out explicitly rather than using the /i flag,
// which would also make PHRASE's own upper/lowercase distinction — the
// thing that stops it from swallowing a whole sentence — stop working.
const ARTICLE_PATTERN = new RegExp(
  `\\b(?:[Tt]he|[Aa]n?|[Ee]ach)\\s+(${PHRASE})\\s*\\((B[TG]-\\d+(?:,\\s*B[TG]-\\d+)*)\\)`,
  "g",
);
// Fallback: no article at all (e.g. "...if Value added tax point date (BT-7)
// is used...") — capture the phrase run immediately before the
// parenthesis, still anchored to a preceding word boundary so it doesn't
// swallow a whole sentence.
const BARE_PATTERN = new RegExp(
  `(?:^|[\\s,.;:"\\]-])(${PHRASE})\\s*\\((B[TG]-\\d+(?:,\\s*B[TG]-\\d+)*)\\)`,
  "g",
);

function collect(pattern, text, found) {
  for (const match of text.matchAll(pattern)) {
    const name = match[1].trim();
    const codes = match[2].match(/B[TG]-\d+/g) ?? [];
    for (const code of codes) {
      const byName = found.get(code) ?? new Map();
      byName.set(name, (byName.get(name) ?? 0) + 1);
      found.set(code, byName);
    }
  }
}

/** @returns {Map<string, Map<string, number>>} code -> (candidate name -> occurrence count) */
export function extractCandidateNames(schematronText) {
  /** @type {Map<string, Map<string, number>>} */
  const found = new Map();
  collect(ARTICLE_PATTERN, schematronText, found);
  collect(BARE_PATTERN, schematronText, found);
  return found;
}

export function extractFromFiles(paths) {
  /** @type {Map<string, Map<string, number>>} */
  const merged = new Map();
  for (const path of paths) {
    const text = readFileSync(path, "utf-8");
    const found = extractCandidateNames(text);
    for (const [code, byName] of found) {
      const target = merged.get(code) ?? new Map();
      for (const [name, count] of byName) {
        target.set(name, (target.get(name) ?? 0) + count);
      }
      merged.set(code, target);
    }
  }
  return merged;
}
