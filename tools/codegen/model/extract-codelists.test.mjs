import { test } from "node:test";
import assert from "node:assert/strict";
import { extractCodelists } from "./extract-codelists.mjs";

const SAMPLE = `
  <rule context="ram:CategoryTradeTax/ram:CategoryCode" flag="fatal">
    <assert
      test="((not(contains(normalize-space(.), ' ')) and contains(' AE L M E S Z G O K B ', concat(' ', normalize-space(.), ' '))))"
      flag="fatal"
      id="BR-CL-17">[BR-CL-17]-Invoice tax categories MUST be coded using UNCL 5305 code list</assert>
  </rule>
  <rule context="ram:ClassCode[@listID]" flag="fatal">
    <assert
      test="((not(contains(normalize-space(@listID), ' ')) and contains(' AA AB ', concat(' ', normalize-space(@listID), ' '))))"
      id="BR-CL-13"
      flag="fatal">[BR-CL-13]-Item classification identifier identification scheme identifier MUST be coded using one of the UNTDID 7143 list.</assert>
  </rule>
`;

test("extracts codes regardless of attribute order (test/flag/id vs test/id/flag)", () => {
  const lists = extractCodelists(SAMPLE);
  assert.deepEqual(lists.get("BR-CL-17").codes, [
    "AE",
    "L",
    "M",
    "E",
    "S",
    "Z",
    "G",
    "O",
    "K",
    "B",
  ]);
  assert.deepEqual(lists.get("BR-CL-13").codes, ["AA", "AB"]);
});

test("keeps the rule's own description text", () => {
  const lists = extractCodelists(SAMPLE);
  assert.equal(
    lists.get("BR-CL-17").description,
    "Invoice tax categories MUST be coded using UNCL 5305 code list",
  );
});

test("finds nothing in text with no BR-CL rule", () => {
  const lists = extractCodelists('<rule><assert id="BR-1" test="true()">ok</assert></rule>');
  assert.equal(lists.size, 0);
});
