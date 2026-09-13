/**
 * The serialization plan interpreter (ADR-004). Hand-written, ~150 lines,
 * and does not change when a profile or a field is added to the plan
 * (plan-v0.1 §4.2) — only `generated/plan.ts` grows.
 *
 * Deterministic by construction: no `Date.now()`, no random IDs, no
 * pretty-printing, element order is exactly the plan's own child order.
 */
import type { AttributeNode, PlanNode, QName } from "./plan-types.js";

const NAMESPACES: Record<string, string> = {
  rsm: "urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100",
  ram: "urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100",
  udt: "urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100",
  qdt: "urn:un:unece:uncefact:data:standard:QualifiedDataType:100",
};

function escapeText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(value: string): string {
  return escapeText(value).replace(/"/g, "&quot;");
}

function qname(name: QName): string {
  return `${name.prefix}:${name.local}`;
}

/**
 * Reads a dotted-or-plain property path off an unknown value; undefined if
 * any segment is missing. An empty path means "the context itself" — used
 * when a parent `element`/`repeat` node already descended (via its own
 * `from`) into the exact value a child `value` node needs, e.g. a
 * `SpecifiedLegalOrganization` element with `from: "legalRegistrationIdentifier"`
 * puts that string itself in context for its nested `ID` value node.
 */
function resolve(context: unknown, path: string): unknown {
  if (path === "") return context;
  let current = context;
  for (const segment of path.split(".")) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function formatValue(raw: unknown, format: ValueFormatArg): string {
  if (format === "date-cii") {
    // IsoDate "YYYY-MM-DD" -> CII qualified-date "102" (YYYYMMDD).
    return String(raw).replaceAll("-", "");
  }
  // "amount" and "text": the model already carries the final string form
  // (Amount = string, ADR-004) — emit as-is, no reformatting here.
  return String(raw);
}

type ValueFormatArg = "text" | "amount" | "date-cii" | "literal" | undefined;

function renderAttributes(attrs: readonly AttributeNode[] | undefined, context: unknown): string {
  if (!attrs || attrs.length === 0) return "";
  const parts: string[] = [];
  for (const attr of attrs) {
    // NOTE: `attr.from` can legitimately be "" (self-reference, see
    // `resolve`'s doc comment) — an empty string is falsy in JS, so this
    // must check `!== undefined`, not truthiness (found the hard way: a
    // `from: ""` attribute silently resolved to `undefined` and vanished).
    const value =
      attr.literal ?? (attr.from !== undefined ? resolve(context, attr.from) : undefined);
    if (value === undefined || value === null) continue;
    parts.push(` ${attr.name}="${escapeAttr(String(value))}"`);
  }
  return parts.join("");
}

function renderNode(node: PlanNode, context: unknown, out: string[]): void {
  if (node.kind === "value") {
    // Same `!== undefined` requirement as renderAttributes above.
    const raw = node.literal ?? (node.from !== undefined ? resolve(context, node.from) : undefined);
    if (raw === undefined || raw === null || raw === "") return;
    const tag = qname(node.name);
    const attrs = renderAttributes(node.attributes, context);
    out.push(`<${tag}${attrs}>${escapeText(formatValue(raw, node.format))}</${tag}>`);
    return;
  }

  if (node.kind === "element") {
    const childContext = node.from === undefined ? context : resolve(context, node.from);
    if (node.from !== undefined && (childContext === undefined || childContext === null)) return;
    const tag = qname(node.name);
    const attrs = renderAttributes(node.attributes, childContext);
    if (!node.children || node.children.length === 0) {
      out.push(`<${tag}${attrs}/>`);
      return;
    }
    const inner: string[] = [];
    for (const child of node.children) renderNode(child, childContext, inner);
    if (inner.length === 0) {
      out.push(`<${tag}${attrs}/>`);
      return;
    }
    out.push(`<${tag}${attrs}>`, ...inner, `</${tag}>`);
    return;
  }

  // repeat
  const items = resolve(context, node.from);
  if (!Array.isArray(items) || items.length === 0) return;
  const effectiveItems = node.firstOnly ? items.slice(0, 1) : items;
  for (const item of effectiveItems) {
    const tag = qname(node.name);
    const attrs = renderAttributes(node.attributes, item);
    const inner: string[] = [];
    for (const child of node.children) renderNode(child, item, inner);
    if (inner.length === 0) {
      out.push(`<${tag}${attrs}/>`);
    } else {
      out.push(`<${tag}${attrs}>`, ...inner, `</${tag}>`);
    }
  }
}

/**
 * Serializes a model value against a root plan node (an "element" node for
 * the document root), producing the full XML document — namespace
 * declarations, fixed prefixes, no pretty-printing, LF-free single line
 * (ADR-004: byte stability, not human readability).
 */
export function serializeWithPlan(root: PlanNode, data: unknown): string {
  if (root.kind !== "element") throw new Error("root plan node must be an element");
  const nsDecls = Object.entries(NAMESPACES)
    .map(([prefix, uri]) => ` xmlns:${prefix}="${uri}"`)
    .join("");
  const tag = qname(root.name);
  const inner: string[] = [];
  for (const child of root.children ?? []) renderNode(child, data, inner);
  return `<?xml version="1.0" encoding="UTF-8"?><${tag}${nsDecls}>${inner.join("")}</${tag}>`;
}
