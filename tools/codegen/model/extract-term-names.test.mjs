import { test } from "node:test";
import assert from "node:assert/strict";
import { extractCandidateNames } from "./extract-term-names.mjs";

test("extracts a name preceded by 'the'", () => {
  const found = extractCandidateNames("An Invoice shall contain the Seller name (BT-27).");
  // Both patterns may also produce longer/overlapping candidates (that's
  // fine — generate.mjs only needs the *correct* name to be somewhere in
  // the set); what matters is the real name is discoverable.
  assert.ok(found.get("BT-27").has("Seller name"));
});

test("extracts a name preceded by 'Each' (sentence-initial, capitalized)", () => {
  const found = extractCandidateNames(
    "Each Item attribute (BG-32) shall contain an Item attribute name.",
  );
  assert.ok(found.get("BG-32").has("Item attribute"));
});

test("a multi-word name with a recurring capitalized noun mid-phrase is not cut short", () => {
  const found = extractCandidateNames(
    "[BR-55]-Each Preceding Invoice reference (BG-3) shall contain a Preceding Invoice reference (BT-25).",
  );
  assert.ok(found.get("BG-3").has("Preceding Invoice reference"));
  assert.ok(found.get("BT-25").has("Preceding Invoice reference"));
});

test("stops at the sentence's real verb instead of running past it", () => {
  const found = extractCandidateNames("An Invoice shall have an Invoice number (BT-1).");
  assert.ok(found.get("BT-1").has("Invoice number"));
  // The bug this guards against: without a stopword boundary, "shall have"
  // gets swallowed and the candidate becomes the whole sentence fragment.
  assert.ok(!found.get("BT-1").has("Invoice shall have an Invoice number"));
});

test("extracts a bare mention with no article, via the fallback pattern", () => {
  const found = extractCandidateNames(
    "[BR-CO-03]-Value added tax point date (BT-7) and Value added tax point date code (BT-8) are mutually exclusive.",
  );
  assert.ok(found.get("BT-7").has("Value added tax point date"));
  assert.ok(found.get("BT-8").has("Value added tax point date code"));
});

test("splits a comma-separated code list across both codes", () => {
  const found = extractCandidateNames("the Seller VAT identifier (BT-31, BT-63) shall be present.");
  assert.ok(found.get("BT-31").has("Seller VAT identifier"));
  assert.ok(found.get("BT-63").has("Seller VAT identifier"));
});

test("a leading conjunction is not mistaken for the start of the term name", () => {
  const found = extractCandidateNames(
    "[BR-CO-20]-If Invoice line period (BG-26) is used, the Invoice line net amount shall be positive.",
  );
  assert.ok(found.get("BG-26").has("Invoice line period"));
  assert.ok(!found.get("BG-26").has("If Invoice line period"));
});

test("returns no candidates for a code that never appears", () => {
  const found = extractCandidateNames("nothing relevant here");
  assert.equal(found.get("BT-999"), undefined);
});
