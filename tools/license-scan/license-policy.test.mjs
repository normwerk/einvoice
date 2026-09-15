import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEV_ALLOWED_LICENSES,
  RUNTIME_ALLOWED_LICENSES,
  isLicenseAllowed,
  normalizeLicenseField,
} from "./license-policy.mjs";

test("normalizeLicenseField: plain SPDX string", () => {
  assert.deepEqual(normalizeLicenseField({ license: "MIT" }), {
    identifiers: ["MIT"],
    requiresAll: false,
  });
});

test("normalizeLicenseField: parenthesized OR expression", () => {
  // type-fest's own real license field, seen in this workspace's own tree.
  assert.deepEqual(normalizeLicenseField({ license: "(MIT OR CC0-1.0)" }), {
    identifiers: ["MIT", "CC0-1.0"],
    requiresAll: false,
  });
});

test("normalizeLicenseField: parenthesized AND expression", () => {
  // pako's own real license field, seen in this workspace's own tree.
  assert.deepEqual(normalizeLicenseField({ license: "(MIT AND Zlib)" }), {
    identifiers: ["MIT", "Zlib"],
    requiresAll: true,
  });
});

test("normalizeLicenseField: legacy single-object form", () => {
  assert.deepEqual(normalizeLicenseField({ license: { type: "MIT", url: "https://x" } }), {
    identifiers: ["MIT"],
    requiresAll: false,
  });
});

test("normalizeLicenseField: legacy licenses array form (pre-SPDX npm convention)", () => {
  assert.deepEqual(normalizeLicenseField({ licenses: [{ type: "MIT" }, { type: "Apache-2.0" }] }), {
    identifiers: ["MIT", "Apache-2.0"],
    requiresAll: false,
  });
});

test("normalizeLicenseField: missing license field entirely", () => {
  assert.deepEqual(normalizeLicenseField({}), { identifiers: ["UNKNOWN"], requiresAll: false });
});

test("normalizeLicenseField: unrecognized shape (neither string, object with type, nor array) falls back to UNKNOWN", () => {
  assert.deepEqual(normalizeLicenseField({ license: 42 }), {
    identifiers: ["UNKNOWN"],
    requiresAll: false,
  });
});

test("isLicenseAllowed: OR expression passes if any identifier is allowed", () => {
  const normalized = normalizeLicenseField({ license: "(MIT OR CC0-1.0)" });
  // CC0-1.0 alone is not in the strict runtime set, but MIT is present as an alternative.
  assert.equal(isLicenseAllowed(normalized, RUNTIME_ALLOWED_LICENSES), true);
});

test("isLicenseAllowed: AND expression with an allowed pair passes (pako's own real license)", () => {
  // Zlib is deliberately in RUNTIME_ALLOWED_LICENSES (license-policy.mjs's own doc comment: a real,
  // unavoidable transitive dependency of pdf-lib -> einvoice-pdfa, provably non-copyleft) — this is the
  // exact real license string pako itself declares.
  const normalized = normalizeLicenseField({ license: "(MIT AND Zlib)" });
  assert.equal(isLicenseAllowed(normalized, RUNTIME_ALLOWED_LICENSES), true);
  assert.equal(isLicenseAllowed(normalized, DEV_ALLOWED_LICENSES), true);
});

test("isLicenseAllowed: AND expression needs every identifier allowed", () => {
  const normalized = normalizeLicenseField({ license: "(MIT AND GPL-3.0-only)" });
  assert.equal(isLicenseAllowed(normalized, RUNTIME_ALLOWED_LICENSES), false);
  assert.equal(isLicenseAllowed(normalized, DEV_ALLOWED_LICENSES), false);
});

test("isLicenseAllowed: UNKNOWN is never allowed, runtime or dev", () => {
  const normalized = normalizeLicenseField({});
  assert.equal(isLicenseAllowed(normalized, RUNTIME_ALLOWED_LICENSES), false);
  assert.equal(isLicenseAllowed(normalized, DEV_ALLOWED_LICENSES), false);
});

test("RUNTIME_ALLOWED_LICENSES rejects a real copyleft license (GPL-3.0-only)", () => {
  const normalized = normalizeLicenseField({ license: "GPL-3.0-only" });
  assert.equal(isLicenseAllowed(normalized, RUNTIME_ALLOWED_LICENSES), false);
  assert.equal(isLicenseAllowed(normalized, DEV_ALLOWED_LICENSES), false);
});

test("DEV_ALLOWED_LICENSES permits plan-v0.1's own two named exceptions (WTFPL, EUPL-1.2)", () => {
  assert.equal(
    isLicenseAllowed(normalizeLicenseField({ license: "WTFPL" }), DEV_ALLOWED_LICENSES),
    true,
  );
  assert.equal(
    isLicenseAllowed(normalizeLicenseField({ license: "EUPL-1.2" }), DEV_ALLOWED_LICENSES),
    true,
  );
  // Neither is allowed in a runtime dependency — the plan's own "только dev" ("dev only").
  assert.equal(
    isLicenseAllowed(normalizeLicenseField({ license: "WTFPL" }), RUNTIME_ALLOWED_LICENSES),
    false,
  );
  assert.equal(
    isLicenseAllowed(normalizeLicenseField({ license: "EUPL-1.2" }), RUNTIME_ALLOWED_LICENSES),
    false,
  );
});
