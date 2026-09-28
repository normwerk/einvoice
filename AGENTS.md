# Agent Operating Rules — EN 16931 e-invoicing core & adapters

Operating rules for AI agents and human contributors working in this repository.
Adapted from a portable rule set; sections that belonged to a mobile / on-device-model product were removed, and the quality gate was replaced with the conformance gate of section 8.

**Read this file before the first action in a task. Section 1 tells you where the truth lives.**

## Fixed for this project

| Fact | Value |
|---|---|
| What this is | MIT TypeScript core for structured e-invoices (EN 16931) + thin adapters for Medusa v2 and Vendure |
| Runtime | Node.js 22 LTS+ (developed/CI'd against 22, `engines.node: ">=22"` — no upper bound; see D-39), TypeScript strict, pnpm workspaces |
| Package scope | `@normwerk/` — fixed 2026-09-12. Packages are `@normwerk/einvoice-model`, `@normwerk/einvoice-cii`, … |
| Repository visibility | **Public** (MIT). Everything committed here is world-readable — see section 5 |
| Conformance tooling | Official validators in Docker (JVM): KoSIT XRechnung, Mustang, Helger phive, veraPDF |
| Docs index | `docs/README.md` |
| Domain knowledge base | `docs/domain-glossary.md` |
| Implementation plans | `ecom docs/plan-*.md` — **outside this repository**, see section 1 |
| Language | Code identifiers, comments, logs, public docs, commit messages: **English**. Private strategy documents: Russian. Chat: follow the user |

---

## 0. Meta

- Follow the user's latest request narrowly. Do not expand scope.
- Prefer simple, readable code; fewer lines; remove unused imports.
- Prefer pure functions for new helpers. In the core layers this is not a preference but a rule (section 6).
- When brevity conflicts with explicit types (section 13), **types win**.
- Do not commit, push, or open PRs unless the user explicitly asks.
- Commit messages carry no AI co-author trailers (`Co-Authored-By: Claude …` and the like) and no session links. The `commit-msg` hook strips them; do not re-add them by hand. Author identity is the maintainer's own name and `@normwerk` address.
- Never claim a validation, test, or build passed unless you actually ran it and saw it pass (section 7).

---

## 1. Source of truth

Strategy, roadmap, backlog and decision log live in the maintainer's own planning workspace, outside this
repository, and outrank this file. On a conflict, follow the strategy and raise the conflict with the
maintainer rather than resolving it here.

Rules: (1) **Never copy business content into this repository** — revenue models, rates, partner details,
jurisdiction analysis, outreach lists, pricing. Not in docs, not in comments, not in commit messages; this
repository is public. (2) Public docs describe the **implemented state** of the software and nothing else.
(3) If a task needs a strategy decision you don't have, stop and ask — do not reconstruct it or guess.

Internal identifiers you'll see throughout this file and in code comments (`T-NNN`, `P-NN`, `M-NNN`,
`D-NN`, `plan-v0.1 §N`) point into that private workspace and are not publicly resolvable. They belong in
code comments and commit messages only — never in text a user reads (section 12, `docs/conventions.md`).

---

## 2. Domain knowledge base

**Why:** this domain is dense with non-obvious conventions (BT/BG numbering, customization IDs, profile constraints, code list versions). An agent must not guess them.

**Path:** `docs/domain-glossary.md`. Create it when first needed.

**Before a task** — read it and treat it as the source of truth for domain conventions. On ambiguous wording, check there first:
- which EN 16931 business term (BT/BG) a field maps to, and which binding table says so;
- which artifact version a rule comes from (CIUS version, code list release, Schematron version);
- which layer owns a rule (format constraint vs commerce semantics — section 6).

**During** — follow existing conventions; do not introduce parallel abstractions for something already modelled.

**After** — add 1–5 short, project-specific bullets ("easy to miss" / "common pitfalls"). No generic advice. Example of a good bullet: "XRechnung requires BT-10 BuyerReference even when Leitweg-ID is absent — BR-DE-15, not caught by XSD."

---

## 3. Capture deferred work — never silently drop ideas

When an idea, improvement, edge case, refactor, or feature appears that is **not** part of the current task:
- Do **not** implement it now.
- Do **not** silently forget it.
- Append one actionable line (**what + why**) to `ecom docs/todo.md` as a new `T-NNN` with status `todo`, under the fitting epic. Never renumber or reuse IDs. A closed task is marked `done YYYY-MM-DD`; at the next week boundary closed tasks move verbatim to `ecom docs/archive/todo-done.md`. The next free number is the highest across the active file **and** its archive — the same for `M-NNN` across `my-tasks.md`, `my-tasks-legal.md` and `archive/my-tasks-closed.md`.

Also maintain `ecom docs/roadmap.md`: slot the idea under the release that fits, or under "Не запланировано" with an explicit trigger. Planning only — do not implement. The human marks releases as shipped.

Human-only action items (accounts, API keys, billing, console setup, licenses, legal, outreach) go to `ecom docs/my-tasks.md` as `M-NNN · open · …` with the blocked result named. Consultations, reviews and audits by lawyers, tax advisors or other outside experts go to `ecom docs/my-tasks-legal.md` in the same format; the `M-NNN` sequence is shared by both files. Mark `blocked(M-NNN)` on the dependent `T-NNN`.

Never store secrets in this repository. Leave a `__________` placeholder and ask the user to put the real value in a secret manager.

---

## 4. Scope gate — before building anything new

Scope is fixed in `ecom docs/STRATEGY.md` §2 and deliberately narrow. This gate replaces the product-hypothesis gate of the portable rules: the product shape is already decided, so the question is not "is this a good feature" but "is this inside the probe".

Applies to: new packages, new profiles, new platform adapters, new delivery channels, anything from `todo.md` phrased open-endedly, and any request shaped as "also add X".

Skip for: bug fixes, refactors, tests, docs, tooling, and clear follow-through of an agreed step in `ecom docs/plan-*.md`.

Check, briefly:
1. **In scope?** Named in `STRATEGY.md` §2 "В scope"? If it appears in "Вне scope", stop.
2. **Which layer?** Format, commerce, adapter, or conformance (section 6). Something that does not fit a layer usually does not belong.
3. **Smaller version?** Is there a version that delivers most of the value inside the current release?
4. **Already covered?** By an existing package or by a PDF plugin we sit on top of.
5. **Cost of carry.** Every profile, code list and platform version added is maintained forever, against a maintainer SLA (section 15).

| Outcome | Action |
|---|---|
| **In scope, clear** | Implement now |
| **Better shape** | Propose a concrete alternative; **do not code** until the user picks |
| **Out of scope** | Do not code. Capture per section 3 (`roadmap.md` → "Не запланировано" with a trigger) and say so in one line |

Challenge early, one clear recommendation, no ceremony on obvious work.

---

## 5. License and data gate

Two hard gates specific to this project. Both block coding, not review.

### 5.1 License gate

Decision D-17 / M-005: **zero third-party e-invoicing libraries in runtime.** Serializers are ours, generated from official artifacts.

- Runtime dependencies: permissive only — MIT / Apache-2.0 / BSD / ISC. Pending final policy M-019.
- `e-invoice-eu` (WTFPL), `@stackforge-eu/factur-x` (EUPL-1.2), `node-zugferd` — **devDependencies only**, as differential oracles. Never imported from a published package's runtime code.
- Copyleft (GPL/AGPL/EUPL) in runtime: forbidden, no exceptions. CI enforces this (T-003); if you need to add a dependency that trips it, stop and ask.
- Official artifacts (CEN binding tables, XSD, code lists, Schematron) have their own licences and redistribution terms. Record every artifact's source URL, version and hash in `docs/sources.md` before use, and check whether it may be vendored or must be fetched.

### 5.2 Data gate

The Uzbek development side must not touch personal data (decision D-08), and this repository is public.

- **Fixtures are synthetic.** Never commit a real invoice, a real customer name, address, VAT-ID, bank detail, or order export. Anonymised real invoices (M-007) are anonymised **before** they reach the repository, and the anonymisation is verified by a human.
- Never log invoice payloads at info level or above. Debug logging of payloads must be opt-in and off by default.
- Test data uses obviously fake identities (`Musterfirma GmbH`, VAT-IDs from documented test ranges).
- If a task would make the library store, transmit or log personal data in a new way, stop and ask before implementing.

---

## 6. Architecture discipline

Layers, strictly ordered. A lower layer never imports a higher one.

| Layer | Packages | Rule |
|---|---|---|
| **Model** | `einvoice-model` | Generated types, code lists, JSON Schema. No logic, no I/O |
| **Format** | `einvoice-cii`, `einvoice-ubl`, `einvoice-pdfa` | Pure functions: model in, bytes out. No I/O except the PDF byte buffer it is handed. No platform types, no network, no filesystem, no clock, no randomness |
| **Commerce** | `einvoice-commerce` | The real value: order/refund → EN 16931 semantics. Pure. Platform-agnostic — no Medusa or Vendure types, ever |
| **Adapter** | `einvoice-medusa`, `einvoice-vendure` | Thin. Subscribes to platform events, maps platform entities to `CommerceInvoiceInput`, stores the result. Contains no tax logic and no XML |
| **Conformance** | `einvoice-conformance` | Dev tooling: runs validators and oracles. Never a runtime dependency of anything shipped |

Consequences you must respect:

- **The core is pure.** If you find yourself needing `Date.now()`, a UUID, or a file read inside model/format/commerce, pass it in as a parameter instead. This is what makes byte-stable output and an HTTP wrapper possible later.
- **Tax logic lives in commerce, never in an adapter and never in a serializer.** A serializer that decides a VAT category is a bug, even if the output validates.
- **Adapters stay thin** — that is the entire premise of the architecture (D-16). If an adapter grows logic, that logic belongs in commerce.

Golden workflow:
- **TDD**: write the failing test first, then the implementation.
- **Definition of Done** = code + this step's tests green + previously green tests still green + typecheck clean + build passes + conformance gate green for touched serializers (section 8).
- Do not run ahead of the current task; defer per section 3.

---

## 7. Environment fence

Building and unit-testing needs Node 22 and pnpm. **Conformance validation needs Docker and a JVM-based toolchain**; there is no pure-JS EN 16931 validator (`researches/02`).

- On a host without Docker: read, edit, plan, and write tests — but **do not claim conformance results**. State the exact commands to run on a Docker-capable host and stop.
- Never substitute a hand-written XSD check, a regex, or your own reading of the spec for a validator run, and never describe an unrun check as passing. A wrong "validator green" is worse than no answer: the entire project's credibility rests on these outputs being verifiably correct.
- Validator images are pinned by digest, not by tag. Updating a validator version is its own task, with the fixture diff reviewed.
- Do not run against any environment holding real merchant data. Fixtures and sandboxes only.

---

## 8. Conformance gate — the quality bar

This replaces the model life-tests of the portable rules. It applies to any change to `einvoice-model`, `einvoice-cii`, `einvoice-ubl`, `einvoice-pdfa`, or `einvoice-commerce`. Deterministic tooling changes do not need it.

Every fixture must pass, at every level that applies to it. **All of them, not a percentage** — unlike a model quality score, conformance is binary and a single failure means a merchant's invoice is rejected by a tax authority.

| Level | Check | Tool |
|---|---|---|
| L1 | Schema valid | XSD (UBL 2.1 / CII D16B) |
| L2 | Business rules | KoSIT Schematron (XRechnung), phive (Peppol BIS) |
| L3 | Profile valid | Mustang (ZUGFeRD/Factur-X), veraPDF (PDF/A-3b) |
| L4 | Differential | Our XML vs `e-invoice-eu` and `@stackforge-eu/factur-x`, canonicalised (c14n), whitespace- and order-normalised |
| L5 | Round-trip | Our XML parsed by Mustang; totals and key BTs compared back to the model |

Rules:
1. A new scenario ships with a fixture. No fixture, no merge.
2. **An L4 difference is never dismissed.** Classify it in the diff report as: our bug / their bug / permissible variation — with the clause of EN 16931 or the CIUS that justifies the verdict. "Probably fine" is not a classification.
3. L1–L3 green with an unexplained L4 difference is not green.
4. If the pass rate plateaus, do not tweak endlessly: bring the diff report and stop for a decision.
5. **Validators do not catch tax semantics** — VAT category choice, OSS, reverse charge, numbering. These are covered by scenario fixtures and by `docs/tax-semantics.md`. Green validators are necessary, never sufficient. Say so whenever you report results.

---

## 9. Generated code

Model types, code lists and format bindings are generated from official artifacts (D-17, ADR-002). Therefore:

- **Never hand-edit a generated file.** Change the generator or the source artifact, then regenerate.
- Generated files carry a header naming the generator, the source artifact and its version, and are committed (so diffs are reviewable) but excluded from manual review noise via `.gitattributes linguist-generated`.
- Regeneration must be deterministic: same artifacts in, byte-identical files out. A regeneration producing a spurious diff is a bug in the generator.
- Updating an artifact version (a new CIUS, a new code list release) is its own task: update `docs/sources.md`, regenerate, review the fixture diff, record the behaviour change.

---

## 10. Deterministic output

XML output must be byte-stable for the same input: fixed element order from the binding table, fixed number formatting, no timestamps or UUIDs generated inside the serializer (pass them in), stable namespace prefixes, LF line endings, no pretty-printing variance.

This is not cosmetic — the differential oracle (L4) and every golden-file test depend on it.

---

## 11. Tests after every change

After any change to production code:
- Run the relevant suites and keep them green. Unit suite always; conformance suite after any serializer, model or commerce change; adapter e2e after adapter changes.
- Fix failures and linter errors you introduced before finishing. Never leave red tests.

Test catalog:
- `docs/test-cases.md` lists every case grouped by suite, with wording identical to the test description; update counts when adding.
- `docs/manual-testing.md` holds step-by-step scenarios that cannot be automated — chiefly the quickstart run in a clean `create-medusa-app` and the Vendure equivalent (action → expected result, real UI labels).

---

## 12. Documentation

**Before a task** — check `docs/README.md`, read the docs for the area you will touch, follow the domain glossary (section 2).

**After** — add or update a short doc under `docs/` for a finished feature; update docs for any contract you changed, in the same task; record non-obvious conventions you learned in the glossary.

Structure: `docs/README.md` is the root index; feature docs at `docs/features/<feature>.md`; cross-cutting docs at `docs/` root; every doc links back to the index.

Rules:
- Document the **implemented** state. Plans and strategy both live outside this repository, in `ecom docs/` (section 1).
- Keep docs short: purpose, key files, tests, status.
- Reference real symbols and paths so docs stay searchable.
- Two documents are mandatory before v0.1 ships: `docs/mapping-reference.md` (platform field → BT) and `docs/tax-semantics.md` ("what the validator does not catch").
- Do not add unsolicited markdown beyond what these rules require.
- **Internal identifiers live only in code comments and commit messages.** Every other text is user-facing and never references private planning documents or their identifiers (`STRATEGY.md`, `plan-*.md`, `T-NNN`, `P-NN`, `M-NNN`, `D-NN`): error messages, log lines, admin UI, README, npm descriptions, and every page under `docs/` — normwerk.dev publishes those pages as they are. Reference a public `docs/` page, a legal source, or a stable error code instead. Doc comments the site extracts (plugin options, error classes) stay comments; the site strips identifiers from them when it publishes them. Decided 2026-09-23 (M-042).
- Public text (README, `docs/`, error messages, npm descriptions) never promises a tax or legal review, and never marks anything "pending review". A review is stated only after it happened, with date and scope, as a fact. "Tax advisor" in public text always means the merchant's own advisor. Internal planning of reviews lives outside this repository.

---

## 13. Fully typed functions

TypeScript strict across the repository.

- Explicit types on all parameters; explicit return types on everything exported, and on handlers and subscribers.
- **Forbidden in new code:** `any`, non-null assertions used to silence the checker, `@ts-ignore` / `@ts-expect-error` without a reason comment, widening a public type to silence an error.
- **Prefer:** named DTOs next to the domain; types derived from the generated model or from JSON Schema rather than restated by hand. If you are hand-writing a type that describes an EN 16931 structure, you are probably bypassing the generator (section 9).
- Temporary bridge: a local `unknown` + narrowing, with an English comment `// TODO: type this (<reason>)`. Never spread an untyped escape across a package boundary.
- When editing an already loose function, do not make it worse; clean where reasonable.
- Typecheck must stay green.

---

## 14. Scope and planning hygiene

- Implement only the current task.
- Out-of-scope ideas → section 3.
- Prefer the smallest change that satisfies the request.
- Match existing style; do not drive-by refactor.
- Do not create markdown docs beyond what sections 3, 11 and 12 require.

---

## 15. Maintainer obligations

The plugin is a demand probe and a reputation carrier (D-09). An abandoned-looking repository costs more than no repository.

- Issue response SLA: **3 business days**, even if the answer is "not now".
- Compatibility matrix for Medusa and Vendure versions stays current. `e2e.yml` runs the e2e suite (T-078)
  nightly and on demand — `fast` profile only, against the Medusa release pinned in `e2e/app/`. A run against
  a freshly scaffolded Medusa `latest`, and a scheduled run across Medusa releases, are not built yet. Do not
  describe them as existing; this line has twice been out of step with the workflows, which is exactly the
  failure §1 of this document forbids.
- If the project is wound down, archive it **explicitly**: README switches to "looking for maintainer", per the archiving policy (T-002). Never abandon silently.
- `README.md` carries the "Commercial support" line (contact `hello@normwerk.dev`) and a pinned "Who is using this?" issue — these are the probe's measurement instruments (`researches/05`), not decoration. Do not remove them.
