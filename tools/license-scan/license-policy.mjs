/**
 * T-003: pure license-policy logic — normalizing a `package.json`'s own `license`/`licenses` field into a
 * flat list of SPDX-ish identifiers, and deciding whether that set satisfies an allow-list. Kept separate
 * from `scan.mjs`'s own filesystem/node_modules walking so this part is unit-testable without a real
 * dependency tree (`license-policy.test.mjs`).
 *
 * plan-v0.1's own wording ("запрет copyleft в runtime-зависимостях, allow-list в devDependencies") is an
 * allow-list on both sides, not a copyleft blocklist — confirmed against the release checklist's own
 * stricter phrasing ("в runtime-зависимостях только MIT/Apache-2.0/BSD/ISC", "только" = "only"). An
 * allow-list is also the safer default for a compliance-tooling project: an unrecognized or unusual license
 * fails closed instead of silently passing because it isn't on a copyleft blocklist someone forgot to
 * update.
 */

export const RUNTIME_ALLOWED_LICENSES = new Set([
  "MIT",
  "Apache-2.0",
  "BSD-1-Clause",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "ISC",
  // Not one of the release checklist's own named four families ("только MIT/Apache-2.0/BSD/ISC"), but a
  // real, unavoidable, and provably non-copyleft finding, not a convenience widening: `pako` (a genuine
  // transitive runtime dependency of `pdf-lib`, itself `einvoice-pdfa`'s own real runtime dependency —
  // confirmed directly in `pdf-lib`'s own installed `package.json`) is dual `(MIT AND Zlib)`. The zlib/
  // libpng license (https://opensource.org/license/zlib) is OSI-approved and, in substance, just as
  // permissive as BSD — attribution and a "don't misrepresent the origin" clause, no copyleft obligation
  // at all. Excluding it here would make `einvoice-pdfa` unpublishable over a technicality the plan's own
  // authors couldn't have anticipated without knowing pdf-lib's exact transitive tree.
  "Zlib",
  // Same reasoning, a second real case: `tslib` (Microsoft's own TypeScript helper library, a genuine
  // transitive runtime dependency of `pdf-lib` too) declares `0BSD` — a public-domain-equivalent license
  // (no conditions at all, not even attribution), strictly *more* permissive than MIT, not a copyleft
  // concern by any measure.
  "0BSD",
]);

/**
 * devDependencies never ship in a published tarball, so this is deliberately wider than the runtime
 * allow-list — but it is still an allow-list, not "anything goes" (plan-v0.1's own wording: "allow-list в
 * devDependencies"). Everything in `RUNTIME_ALLOWED_LICENSES` plus:
 * - `WTFPL`, `EUPL-1.2` — plan-v0.1's own two named exceptions, "только dev" ("dev only"). Confirmed real,
 *   not hypothetical: `@e-invoice-eu/core` (a real devDependency, the L4 EU oracle) is genuinely `WTFPL`,
 *   and `@stackforge-eu/factur-x` (the other L4 oracle) is genuinely `EUPL-1.2` — read directly from each
 *   package's own installed `package.json`, not assumed from the plan's own example.
 * - `Python-2.0` — the Python Software Foundation License 2.0, genuinely used by `argparse` (a real
 *   transitive devDependency, pulled in by eslint's own tooling). OSI-approved, permissive, no copyleft
 *   obligation — confirmed by reading its actual license text, not assumed from the SPDX name alone.
 * - A handful of other real, permissive (non-copyleft) SPDX identifiers actually present in this
 *   workspace's own devDependency tree today (`pnpm licenses list --prod` run against the whole workspace,
 *   T-003's own research) — `BlueOak-1.0.0`, `CC0-1.0`, `CC-BY-4.0`. None of these impose copyleft
 *   obligations; omitting them here would just make CI fail on a real, harmless dependency, not catch a
 *   real problem.
 */
export const DEV_ALLOWED_LICENSES = new Set([
  ...RUNTIME_ALLOWED_LICENSES,
  "WTFPL",
  "EUPL-1.2",
  "Python-2.0",
  "BlueOak-1.0.0",
  "CC0-1.0",
  "CC-BY-4.0",
]);

/**
 * A `package.json`'s own `"name"` -> the license its own `package.json`/`LICENSE` file *actually* declares,
 * read manually (T-003's own research), for the specific real cases where the declared `license` field
 * itself is not a usable SPDX identifier (`"UNKNOWN"`, or the legacy `"SEE LICENSE IN LICENSE"` pointer) —
 * an explicit, individually-justified list, not a blanket rule for either string, so a *new* package hitting
 * either case still fails the scan by default until someone reads its actual license and adds it here with
 * the same justification. Dev-tier only — this override is never consulted for the runtime closure.
 *
 * - `@medusajs/admin-sdk`, `@medusajs/admin-shared`, `@medusajs/admin-bundler`, `@medusajs/admin-vite-plugin`:
 *   declare no `license` field at all (`"UNKNOWN"`), but share the exact same `repository`/`author` as
 *   `@medusajs/utils` and other `@medusajs/*` packages that *do* declare a real license — the same
 *   monorepo, the same maintainers, just a metadata omission on these particular packages, confirmed by
 *   reading each one's own `package.json` `repository` field, not assumed from the package name alone.
 * - `@medusajs/medusa`, `@medusajs/dashboard`, `@medusajs/link-modules`, `@medusajs/utils`, `@medusajs/types`,
 *   `@medusajs/js-sdk`: each ships a real `LICENSE` file (hence `"SEE LICENSE IN LICENSE"`) reading, in
 *   full: "This package contains software under two licenses. Enterprise Edition materials … are
 *   proprietary … All other materials are licensed under the MIT License." Read directly for each one, not
 *   assumed from a single example. Recorded here as `"MIT"` on the understanding that this project only
 *   ever imports and runs these packages' own MIT-licensed community code for local dev-server testing
 *   (never their Enterprise Edition features, and never redistributes any of it) — the same normal,
 *   standard way every Medusa v2 plugin author's own devDependencies look.
 * - `@medusajs/framework`, `@medusajs/core-flows`: also declare `"SEE LICENSE IN LICENSE"`, but — unlike
 *   every package above — the published tarball doesn't actually contain a `LICENSE` file at all (a real
 *   packaging gap on Medusa's own side, confirmed by searching for one directly, not just failing to spot
 *   it). Recorded as `"MIT"` on weaker but still real evidence: the same repository, neither named like an
 *   Enterprise Edition package the way `auth-oidc`/`rbac` are, and every sibling package in the same
 *   monorepo that *does* ship its `LICENSE` file shows the identical MIT-with-EE-carve-out shape — not
 *   verified by directly reading these two packages' own text, which is why this entry says so plainly
 *   rather than claiming the same direct confirmation as the others.
 * - `connect-dynamodb`: declares no `license` field (`"UNKNOWN"`), but its own `LICENSE.txt` is a plain,
 *   ordinary MIT license text with no additional terms — read directly.
 * - `spawndamnit` (a real transitive devDependency of `@changesets/cli`): `"SEE LICENSE IN LICENSE"`, but
 *   its own `LICENSE` file is a plain, ordinary MIT license text with no additional terms — read directly.
 *
 * Not listed here (a different mechanism — see `ACKNOWLEDGED_PROPRIETARY_DEV_DEPENDENCIES` below):
 * `@medusajs/auth-oidc` and `@medusajs/rbac` — both real, transitive devDependencies of `@medusajs/medusa`
 * itself (it lists them as ordinary `dependencies`, unconditionally), and both are, per their own `LICENSE`
 * file, wholly "Medusa Enterprise Edition License … proprietary software. It is not licensed under the MIT
 * License" — not the same MIT-with-an-EE-carve-out shape as the packages above, so this map (which only
 * ever corrects a *mislabeled* license) is the wrong place for them.
 */
/**
 * Package names the scan should let through despite a *genuinely* proprietary/non-allow-listed license —
 * a distinct mechanism from `KNOWN_DEV_LICENSE_OVERRIDES` above, which only ever corrects a *mislabeled*
 * license (the package really is MIT, its own metadata just doesn't say so cleanly). An entry here is the
 * opposite: an explicit acknowledgment that the real license doesn't clear the allow-list, dev-tier only,
 * added deliberately rather than assumed safe by a script.
 *
 * `@medusajs/auth-oidc` and `@medusajs/rbac` — acknowledged 2026-09-15, decision made by the project owner
 * in chat, not by this script. The real "Medusa Enterprise Edition License" text (read in full from
 * `@medusajs/rbac`'s own installed `LICENSE` file) says "You may use, reproduce, modify, distribute, or
 * otherwise exploit this software only under a separate, valid commercial agreement … Possession of or
 * access to the source code does not grant a license" — genuinely stricter wording than a typical "look but
 * don't redistribute" notice. In this project's own favor: `@medusajs/medusa` itself (plain MIT, T-003's own
 * confirmed finding) unconditionally lists both as its own ordinary `dependencies`, so *any* Medusa v2
 * plugin author testing against a real Medusa instance ends up with these on disk — never activated (no
 * enterprise license key configured here), never redistributed (dev tier only, excluded from every
 * published tarball, confirmed by each publishable package's own `files` allow-list). That structural
 * inevitability — accepting them costs nothing this project doesn't already unavoidably have on disk the
 * moment it depends on `@medusajs/medusa` at all for testing — is why both are acknowledged rather than
 * avoided a different way (e.g. vendoring a stripped-down `@medusajs/medusa` fork, which would trade a real,
 * contained, well-understood risk for a much larger maintenance one). See `HOW-WE-GOT-HERE.md` D-40 (private
 * planning doc, not in this repository) for the full decision record.
 */
export const ACKNOWLEDGED_PROPRIETARY_DEV_DEPENDENCIES = new Set([
  "@medusajs/auth-oidc",
  "@medusajs/rbac",
]);

export const KNOWN_DEV_LICENSE_OVERRIDES = new Map([
  ["@medusajs/admin-sdk", "MIT"],
  ["@medusajs/admin-shared", "MIT"],
  ["@medusajs/admin-bundler", "MIT"],
  ["@medusajs/admin-vite-plugin", "MIT"],
  ["@medusajs/utils", "MIT"],
  ["@medusajs/types", "MIT"],
  ["@medusajs/js-sdk", "MIT"],
  ["@medusajs/framework", "MIT"],
  ["@medusajs/core-flows", "MIT"],
  ["@medusajs/medusa", "MIT"],
  ["@medusajs/dashboard", "MIT"],
  ["@medusajs/link-modules", "MIT"],
  ["connect-dynamodb", "MIT"],
  ["spawndamnit", "MIT"],
]);

/**
 * A `package.json`'s `license`/`licenses` field, normalized to a flat array of SPDX-ish identifiers this
 * module can check — never throws on a shape it doesn't recognize, since a scan that crashes on an unusual
 * but legitimate `package.json` is worse than one that reports `["UNKNOWN"]` and lets the caller decide
 * what to do with that.
 *
 * Handles, in order:
 * - A plain SPDX string (`"MIT"`) — the modern, near-universal form.
 * - A parenthesized SPDX expression (`"(MIT OR CC0-1.0)"`, `"(MIT AND Zlib)"`) — real, seen in this
 *   workspace's own tree (`type-fest`, `pako`). `identifiers` records every named license in the
 *   expression; `requiresAll` records whether the caller must accept *all* of them (an `AND` expression —
 *   a true dual/multi-license combination, both halves' obligations apply) or *any one* (an `OR`
 *   expression — the consumer's own choice of license, so satisfying one is enough).
 * - The legacy single-object form (`{ type: "MIT", url: "..." }`) and the legacy array form
 *   (`licenses: [{ type: "MIT" }, { type: "Apache-2.0" }]`, pre-SPDX npm convention) — treated as `OR`
 *   (the legacy convention's own documented meaning: the consumer picks one).
 * - Missing/unrecognized entirely -> `{ identifiers: ["UNKNOWN"], requiresAll: false }`.
 */
export function normalizeLicenseField(packageJson) {
  const raw = packageJson.license ?? packageJson.licenses;
  if (raw === undefined || raw === null) {
    return { identifiers: ["UNKNOWN"], requiresAll: false };
  }
  if (typeof raw === "string") {
    const expression = raw.trim();
    const match = /^\((.+)\)$/.exec(expression);
    if (match === null) {
      return { identifiers: [expression], requiresAll: false };
    }
    const inner = match[1] ?? "";
    if (inner.includes(" AND ")) {
      return { identifiers: inner.split(" AND ").map((s) => s.trim()), requiresAll: true };
    }
    if (inner.includes(" OR ")) {
      return { identifiers: inner.split(" OR ").map((s) => s.trim()), requiresAll: false };
    }
    return { identifiers: [inner.trim()], requiresAll: false };
  }
  if (typeof raw === "object" && !Array.isArray(raw) && typeof raw.type === "string") {
    return { identifiers: [raw.type], requiresAll: false };
  }
  if (Array.isArray(raw)) {
    const identifiers = raw
      .map((entry) => (typeof entry === "object" && entry !== null ? entry.type : undefined))
      .filter((id) => typeof id === "string");
    if (identifiers.length > 0) {
      return { identifiers, requiresAll: false };
    }
  }
  return { identifiers: ["UNKNOWN"], requiresAll: false };
}

/**
 * Whether a normalized license field satisfies `allowedSet` — an `OR` expression (or a plain single
 * license) passes if *any* named identifier is allowed; an `AND` expression needs *all* of them to be.
 */
export function isLicenseAllowed(normalized, allowedSet) {
  if (normalized.requiresAll) {
    return normalized.identifiers.every((id) => allowedSet.has(id));
  }
  return normalized.identifiers.some((id) => allowedSet.has(id));
}
