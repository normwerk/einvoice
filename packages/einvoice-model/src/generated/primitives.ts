/**
 * GENERATED FILE — do not hand-edit (AGENTS.md §9).
 *
 * Generator: tools/codegen/model/generate.mjs
 * Source artifacts (see artifacts/MANIFEST.json for hashes):
 *   - artifacts/cii-d16b/schematron/EN16931-CII-validation-preprocessed.sch (EUPL-1.2)
 *   - artifacts/cii-d16b/schematron/EN16931-CII-codes.sch (EUPL-1.2)
 * To change: edit tools/codegen/model/terms.mjs or the artifact, then
 * re-run `pnpm codegen:model` from the repo root.
 */
/** Decimal amount as text — never a JS number (ADR-004: BR-CO-* rules compare amounts exactly). */
export type Amount = string;

/** ISO 8601 calendar date, "YYYY-MM-DD". Syntax-specific formatting (e.g. CII's "102" = YYYYMMDD) is a serializer concern, not a model concern. */
export type IsoDate = string;
