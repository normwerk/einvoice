#!/usr/bin/env node
/**
 * Walks packages/einvoice-cii/src/generated/plan.ts's PlanNode tree and
 * emits docs/mapping-reference.md — one row per BT the plan actually
 * serializes, with its CII XPath (reconstructed from the tree's own
 * nesting, not retyped by hand) and model path.
 *
 * Deterministic: same plan.ts => same table. Re-run after any plan change.
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import { format, resolveConfig } from "prettier";
import { invoicePlan } from "../../../packages/einvoice-cii/dist/generated/plan.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

/** @typedef {{ bt: string, path: string, modelPath: string }} Row */

/** @type {Row[]} */
const rows = [];

function qname(name) {
  return `${name.prefix}:${name.local}`;
}

function walk(node, xpath, modelPathParts) {
  if (node.kind === "value") {
    if (!node.bt) return;
    const fullXpath = `${xpath}/${qname(node.name)}`;
    const modelPath = node.from
      ? [...modelPathParts, node.from].filter(Boolean).join(".")
      : modelPathParts.join(".");
    rows.push({ bt: node.bt, path: fullXpath, modelPath });
    return;
  }
  const childXpath = `${xpath}/${qname(node.name)}`;
  const childModelPath = node.from !== undefined ? [...modelPathParts, node.from] : modelPathParts;
  const children = node.kind === "element" ? (node.children ?? []) : node.children;
  for (const child of children) walk(child, childXpath, childModelPath);
}

walk(invoicePlan, "", []);

// Sort by BT number for a stable, readable table.
function sortKey(bt) {
  const match = /(BT|BG)-(\d+)/.exec(bt);
  return { kind: match?.[1] ?? "BT", num: Number(match?.[2] ?? 0) };
}
rows.sort((a, b) => {
  const left = sortKey(a.bt);
  const right = sortKey(b.bt);
  return left.kind === right.kind ? left.num - right.num : left.kind.localeCompare(right.kind);
});

const header = `# Mapping reference: model → CII

GENERATED from \`packages/einvoice-cii/src/generated/plan.ts\` by
\`tools/codegen/cii/generate-mapping-reference.mjs\` (AGENTS.md §9 — do not hand-edit).
Re-run after any plan change: \`node tools/codegen/cii/generate-mapping-reference.mjs\`.

Only fields the serializer actually emits appear here. Fields the model has but the plan does not serialize
yet — dropped, not rejected: VAT accounting currency (BT-6), value added tax point date and code (BT-7,
BT-8), total VAT in accounting currency (BT-111), invoice line period (BG-26), item attributes (BG-32) and
additional supporting documents (BG-24). Street lines (BT-35/36, BT-50/51) are not in the model at all yet.

| BT/BG | Model path (relative to \`Invoice\`, or to the current line/breakdown/reference item) | CII XPath (relative to \`rsm:CrossIndustryInvoice\`) |
|---|---|---|
`;

const body = rows
  .map((r) => `| ${r.bt} | \`${r.modelPath || "(item)"}\` | \`${r.path}\` |`)
  .join("\n");

const outPath = resolve(REPO_ROOT, "docs/mapping-reference.md");
const config = await resolveConfig(outPath);
const formatted = await format(header + body + "\n", { ...config, filepath: outPath });

writeFileSync(outPath, formatted);
console.log(`Wrote docs/mapping-reference.md with ${rows.length} rows`);
