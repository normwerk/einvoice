import { test } from "node:test";
import assert from "node:assert/strict";
import { canonicalize, diffCanonical } from "./canonicalize.mjs";

test("two documents differing only in namespace prefix and attribute order compare equal", () => {
  const a = `<?xml version="1.0"?><rsm:Root xmlns:rsm="urn:x" xmlns:ram="urn:y"><ram:A b="2" a="1">hi</ram:A></rsm:Root>`;
  const b = `<?xml version="1.0"?><x:Root xmlns:x="urn:x" xmlns:z="urn:y"><z:A a="1" b="2">hi</z:A></x:Root>`;
  const diff = diffCanonical(canonicalize(a), canonicalize(b));
  assert.deepEqual(diff, { onlyInOurs: [], onlyInTheirs: [], differing: [] });
});

test("xsi:schemaLocation is ignored as generator-identity noise", () => {
  const a = `<Root xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="foo"><A>1</A></Root>`;
  const b = `<Root><A>1</A></Root>`;
  const diff = diffCanonical(canonicalize(a), canonicalize(b));
  assert.deepEqual(diff, { onlyInOurs: [], onlyInTheirs: [], differing: [] });
});

test("a genuine text content difference is reported under 'differing'", () => {
  const a = `<Root xmlns:r="urn:x"><r:Amount>100.00</r:Amount></Root>`;
  const b = `<Root xmlns:r="urn:x"><r:Amount>100</r:Amount></Root>`;
  const diff = diffCanonical(canonicalize(a), canonicalize(b));
  assert.equal(diff.differing.length, 1);
  assert.equal(diff.differing[0].ours, "100.00");
  assert.equal(diff.differing[0].theirs, "100");
});

test("an element present only in one document is reported under only-in-*", () => {
  const a = `<Root xmlns:r="urn:x"><r:A>1</r:A><r:B/></Root>`;
  const b = `<Root xmlns:r="urn:x"><r:A>1</r:A></Root>`;
  const diff = diffCanonical(canonicalize(a), canonicalize(b));
  assert.equal(diff.onlyInOurs.length, 1);
  assert.ok(diff.onlyInOurs[0].path.includes("}B[0]"));
  assert.equal(diff.onlyInTheirs.length, 0);
});

test("repeated sibling elements are distinguished by index, not collapsed", () => {
  const a = `<Root xmlns:r="urn:x"><r:Line><r:ID>1</r:ID></r:Line><r:Line><r:ID>2</r:ID></r:Line></Root>`;
  const b = `<Root xmlns:r="urn:x"><r:Line><r:ID>1</r:ID></r:Line><r:Line><r:ID>3</r:ID></r:Line></Root>`;
  const diff = diffCanonical(canonicalize(a), canonicalize(b));
  assert.equal(diff.differing.length, 1);
  assert.ok(diff.differing[0].path.includes("Line[1]"));
});
