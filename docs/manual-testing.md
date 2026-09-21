# Manual testing

Back to [`docs/README.md`](README.md). Scenarios that genuinely cannot be automated — either because the
thing being checked only exists once a human (or an LLM agent driving a real browser) looks at a rendered
UI, or because it depends on external, one-off, or account-specific state (an npm registry, a GitHub
repository, a real e2e harness spun up for the occasion) that isn't something CI can own. Required by
`AGENTS.md` §11, alongside [`docs/test-cases.md`](test-cases.md) for what _is_ automated.

Every item below has already been performed for real at least once (not merely described) — see the commit
history and `docs/domain-glossary.md`/the private planning log for the specific run each finding came from.
This file records the _procedure_, so it can be repeated the same way next time, not a one-off log entry.

## `einvoice-medusa` end-to-end (T-070–T-075)

**Now automated — see [`docs/e2e.md`](e2e.md) (T-078).** `pnpm e2e` runs this same cart → order →
fulfillment → refund → conformance-validator flow against a real Medusa v2 app in CI, with the plugin
packages installed from a disposable local registry rather than `yalc`-linked. What's kept manual below is
the historical record of the six real runs (T-070–T-075) that first established this exact procedure, before
the automated version existed — not a claim that it still needs to be repeated by hand. The one thing T-078
doesn't cover: installing from the _real_ npm registry specifically (its own registry is a local, disposable
one) — that stays `docs/domain-glossary.md`'s own T-076 finding, re-checked once right before an actual
release.

Not automatable in CI _before T-078_: needed a real Postgres, a real freshly-scaffolded Medusa v2
application, and (until the packages were published, T-076) `yalc` linking instead of a real `npm install`.
The procedure, repeated identically across T-070 through T-075's own real runs:

1. `docker run -d -e POSTGRES_PASSWORD=... -e POSTGRES_USER=... -e POSTGRES_DB=... -p <port>:5432 postgres:16-alpine`.
2. Build and `yalc publish --private` every workspace package the plugin depends on
   (`einvoice-model`, `einvoice-commerce`, `einvoice-cii`, `einvoice-pdfa`, `einvoice-medusa`, in that
   dependency order).
3. `npx create-medusa-app@<pinned version> <name> --db-url "postgres://..." --use-npm --no-browser` (a
   `create-medusa-app` version, not `@latest` — the scaffold's own shape has changed between versions, most
   notably the turborepo-style `apps/backend/` layout since ~2.19.0, `docs/domain-glossary.md`'s own T-070
   finding).
4. `yalc add` the five packages in the new app, then a plain `npm install` (not optional — a yalc-linked
   package's _own_ dependencies aren't pulled in by `yalc add` alone, T-073's own finding).
5. Configure `medusa-config.ts`'s `plugins` entry with real, complete `seller`/`payment` options (an
   incomplete config throws `InvalidEinvoiceModuleOptionsError` at boot, by design).
6. `npx medusa db:migrate`, then `npx medusa develop` (killing anything already on port 9000 first — the
   dev server's watcher does not reliably free the port across restarts, a recurring, harmless annoyance).
7. Drive the real Admin/Store HTTP APIs (a cart → order → fulfillment → refund flow) — a plain script
   calling `fetch` against `localhost:9000`, not a UI. Confirm the generated `EinvoiceDocument` row, then
   pull its file(s) out of the File Module and run them through the real conformance tools
   (`docker compose -f docker/compose.conformance.yml run --rm kosit -h <file>.xml`, and `verapdf` for a
   PDF) — this is the same real KoSIT Validator the automated conformance suite uses, just pointed at a
   file this manual flow produced instead of one of the checked-in fixtures.

## Admin widget, visually (T-074)

The "E-Invoices" widget's own rendering, layout, and that a download link actually triggers a real request
— none of this is exercised by a unit test (`src/storage.test.ts` etc. test the logic behind it, not the
React component or its wiring into the real Medusa dashboard). Verified by opening the real dashboard in a
browser, logging in as a real admin user, navigating to a real order's page, and confirming: the "E-Invoices"
section appears in the side column with one row per document; each row's download icons issue a real
`GET .../einvoice/:documentId/{xml,pdf}` request (confirm via the browser's own network log — a
`Content-Disposition: attachment` response opened via `target="_blank"` reports as an aborted navigation in
a sandboxed preview browser, which is expected, not a failure of the route itself).

No screenshot of this is committed to the repository — the environment this was built in has no accessible
display for a real screenshot (`screencapture` genuinely fails with "could not create image from display",
confirmed, not assumed) and the preview browser tool used has no "save frame to file" capability either.
`docs/features/einvoice-medusa.md` records this same gap plainly.

## Store API ownership check, with real accounts (T-074)

**Now automated — see [`docs/e2e.md`](e2e.md) (T-078, `e2e/src/scenarios/store-ownership.test.ts`).**
`customerOwnsOrder`'s own logic has no dedicated unit test (it's three lines wrapping a `query.graph` call —
the real value is in the end-to-end behavior, not the logic in isolation). `pnpm e2e` now checks all three
real states on every run: no bearer token at all (`401`), a different, genuinely registered customer
(real `POST /auth/customer/emailpass/register` + login, `404` — not `403`, so as not to confirm the order
even exists to a non-owner), and the actual owning customer (`200`, byte-identical file, KoSIT-valid).

## npm/GitHub existence checks (T-076)

Two real, external, point-in-time facts that no test suite owns:

- **The `@normwerk` npm scope has no currently-published packages** — checked via
  `https://registry.npmjs.org/-/v1/search?text=%40normwerk` returning zero results. Does not by itself
  prove the _organization_ isn't already registered (an npm org can exist with zero published packages);
  only that nothing would collide on first publish.
- **The GitHub repository exists, canonically at `github.com/Normwerk/einvoice` as of 2026-09-16** — the
  P-10 rename to an all-lowercase register is half applied: GitHub's reply to the P-10 push (`remote: This
repository moved. Please use the new location: git@github.com:Normwerk/einvoice.git`) shows the
  _repository_ renamed to `einvoice` and the _organisation_ still `Normwerk`. Every package's own
  `repository`/`homepage`/`bugs` field already says `normwerk/einvoice`, which resolves through GitHub's
  case-insensitive slugs and this redirect; it becomes the exact canonical spelling once the org is renamed.
  Neither `git remote -v` nor `git ls-remote` can settle casing — the first echoes what a human typed, the
  second succeeds through a redirect without mentioning it; only a real push reports it (see
  `docs/domain-glossary.md`'s own entry). Reachability confirmed by that push, not a public API fetch, since
  the repository is currently **private** (GitHub's API returns the same 404 for "private" as for "doesn't
  exist" to an unauthenticated caller, so a plain `GET /repos/normwerk/einvoice` cannot by itself
  distinguish the two).
  Making it public is a deliberate, separate action the maintainer takes on release day, not before.

Re-check both again immediately before the real publish (T-115's own release-checklist item: "Публичная
перепроверка имени… появившихся с сентября" — a fact that can change between when this file was last
updated and when publish actually happens).

## Third-party license text (T-003)

`tools/license-scan/scan.mjs` catches an SPDX identifier outside the allow-list automatically, but it
cannot itself judge whether an unusual-looking result (`"UNKNOWN"`, the legacy `"SEE LICENSE IN LICENSE"`
pointer, or a genuinely proprietary notice) is actually fine to accept — that took a human (or an agent
acting as one) opening the real installed package's own `LICENSE`/`package.json` and reading it. Every
override currently in `tools/license-scan/license-policy.mjs`'s own `KNOWN_DEV_LICENSE_OVERRIDES` was
produced this way, individually, not pattern-matched — repeat the same manual read for any _new_ package
that starts failing the scan for one of these reasons before adding it to that map.

## Quickstart, by an actual new developer (T-075, release checklist §10)

The quickstart's own written claim ("about 30 minutes") was timed against a scripted run of the exact same
steps (`docs/quickstart-medusa.md`'s own "How this was verified" section) — a real, useful proxy, but not
the same thing as a person who has never seen this codebase actually following the prose instructions
themselves, hitting whatever a script doesn't (an ambiguous instruction, a missing prerequisite, a copy-paste
error). The release checklist's own item — "новый разработчик проходит quickstart за 30 минут… человек, не
писавший код" — needs an actual person for that reason; not yet done.
