/**
 * Extracts codelist value sets directly from the vendored EN 16931 CII codes
 * Schematron (artifacts/cii-d16b/schematron/EN16931-CII-codes.sch, EUPL-1.2).
 * Each `BR-CL-*` rule asserts membership in a space-separated code list
 * inside its `test` attribute — this parses that list back out rather than
 * transcribing it by hand, so a codelist release update just means
 * re-running this against a newer artifact (ADR-002: deterministic
 * regeneration from the same input).
 */
import { readFileSync } from "node:fs";

/**
 * @param {string} schematronText
 * @returns {Map<string, { id: string; description: string; codes: string[] }>} keyed by BR-CL-* id
 */
export function extractCodelists(schematronText) {
  /** @type {Map<string, { id: string; description: string; codes: string[] }>} */
  const lists = new Map();
  // Attribute order varies (test/flag/id in some rules, test/id/flag in
  // others) — match each <assert ...>...</assert> block as a unit first,
  // then pull id/test/message out of it independently of attribute order.
  const blockRe = /<(?:sch:)?assert\b([^>]*)>([^<]*)<\/(?:sch:)?assert>/g;
  for (const block of schematronText.matchAll(blockRe)) {
    const [, attrs, body] = block;
    const idMatch = /\bid="(BR-CL-\d+)"/.exec(attrs);
    if (!idMatch) continue;
    const id = idMatch[1];
    const testMatch = /\btest="([^"]*)"/.exec(attrs);
    if (!testMatch) continue;
    const codesMatch = /contains\(' ([^']+) ',/.exec(testMatch[1]);
    if (!codesMatch) continue;
    const description = body.replace(/^\[BR-CL-\d+\]-?/, "").trim();
    lists.set(id, { id, description, codes: codesMatch[1].trim().split(/\s+/) });
  }
  return lists;
}

export function extractCodelistsFromFile(path) {
  return extractCodelists(readFileSync(path, "utf-8"));
}
