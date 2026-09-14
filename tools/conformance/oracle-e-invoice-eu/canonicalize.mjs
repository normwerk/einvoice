/**
 * T-041/T-042: a pragmatic canonical form for diffing two independently
 * generated XML documents (our CII output vs. an oracle's).
 *
 * This is NOT full W3C XML C14N (the algorithm used for XML signatures) —
 * that spec also defines exclusive namespace-declaration propagation, output
 * encoding, and comment handling that are irrelevant here. What we actually
 * need is: two documents that may differ in namespace *prefixes*, attribute
 * order, and insignificant whitespace should compare equal wherever their
 * real content agrees, and differ only where the content itself differs.
 * This module does exactly that (and nothing more) — naming it accurately
 * so the L4 report doesn't overclaim a W3C-C14N-grade normalization.
 *
 * Each element becomes a path keyed by namespace URI + local name (never by
 * prefix, since prefixes are free to differ between generators) with a
 * same-tag sibling index, e.g.:
 *   /{urn:...CrossIndustryInvoice:100}CrossIndustryInvoice[0]
 *     /{urn:...ReusableAggregateBusinessInformationEntity:100}ExchangedDocument[0]
 *       /{...}ID[0]                              -> "RE-2026-0001"
 *       /{...}ID[0]/@{...}schemeID                -> "..." (if present)
 * Leaf elements (no child elements) map to their trimmed text content
 * (possibly ""); elements with child elements map only through their
 * children (their own text, if any, is ignored — CII has none in practice).
 * `xmlns*` declarations and `xsi:schemaLocation` are dropped: both are
 * generator-identity noise, not EN 16931 business content.
 */
import { DOMParser } from "@xmldom/xmldom";

const XSI_NS = "http://www.w3.org/2001/XMLSchema-instance";

function isElement(node) {
  return node.nodeType === 1;
}

function isText(node) {
  return node.nodeType === 3 || node.nodeType === 4; // text or CDATA
}

function attrKey(attr) {
  return `@{${attr.namespaceURI ?? ""}}${attr.localName}`;
}

function elementKey(el) {
  return `{${el.namespaceURI ?? ""}}${el.localName}`;
}

function collectOwnText(el) {
  let text = "";
  for (const child of Array.from(el.childNodes)) {
    if (isText(child)) text += child.data;
  }
  return text.trim();
}

function walk(el, pathPrefix, siblingCounts, out) {
  const key = elementKey(el);
  const idx = siblingCounts.get(key) ?? 0;
  siblingCounts.set(key, idx + 1);
  const path = `${pathPrefix}/${key}[${idx}]`;

  const attrs = Array.from(el.attributes ?? []).filter((a) => {
    if (a.name === "xmlns" || a.name.startsWith("xmlns:")) return false;
    if (a.namespaceURI === XSI_NS && a.localName === "schemaLocation") return false;
    return true;
  });
  attrs.sort((a, b) => attrKey(a).localeCompare(attrKey(b)));
  for (const a of attrs) out.set(`${path}/${attrKey(a)}`, a.value);

  const childElements = Array.from(el.childNodes).filter(isElement);
  if (childElements.length === 0) {
    out.set(path, collectOwnText(el));
  } else {
    const childCounts = new Map();
    for (const child of childElements) walk(child, path, childCounts, out);
  }
}

/** @returns {Map<string, string>} canonical path -> value */
export function canonicalize(xmlString) {
  let parseError;
  const doc = new DOMParser({
    onError: (level, msg) => {
      if (level === "error" || level === "fatalError") parseError = msg;
    },
  }).parseFromString(xmlString, "application/xml");
  if (parseError) throw new Error(`canonicalize: XML parse error: ${parseError}`);

  const root = doc.documentElement;
  const out = new Map();
  walk(root, "", new Map(), out);
  return out;
}

/**
 * @param {Map<string, string>} ours
 * @param {Map<string, string>} theirs
 */
export function diffCanonical(ours, theirs) {
  const onlyInOurs = [];
  const onlyInTheirs = [];
  const differing = [];
  const keys = new Set([...ours.keys(), ...theirs.keys()]);
  for (const path of keys) {
    const a = ours.get(path);
    const b = theirs.get(path);
    if (a === undefined) onlyInTheirs.push({ path, value: b });
    else if (b === undefined) onlyInOurs.push({ path, value: a });
    else if (a !== b) differing.push({ path, ours: a, theirs: b });
  }
  onlyInOurs.sort((x, y) => x.path.localeCompare(y.path));
  onlyInTheirs.sort((x, y) => x.path.localeCompare(y.path));
  differing.sort((x, y) => x.path.localeCompare(y.path));
  return { onlyInOurs, onlyInTheirs, differing };
}
