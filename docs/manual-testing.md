# Manual testing

Back to [`docs/README.md`](README.md). Scenarios that genuinely cannot be automated — either because the
thing being checked only exists once a human (or an LLM agent driving a real browser) looks at a rendered
UI, or because it depends on external, one-off, or account-specific state (an npm registry, a GitHub
repository, a real e2e harness spun up for the occasion) that isn't something CI can own. Required by
`AGENTS.md` §11, alongside [`docs/test-cases.md`](test-cases.md) for what _is_ automated.

Every item below has already been performed for real at least once (not merely described) — see the commit
history and `docs/domain-glossary.md` for the specific run each finding came from.
This file records the _procedure_, so it can be repeated the same way next time, not a one-off log entry.

## `einvoice-medusa` end-to-end

**Now automated — see [`docs/e2e.md`](e2e.md).** `pnpm e2e` runs this same cart → order →
fulfillment → refund → conformance-validator flow against a real Medusa v2 app in CI, with the plugin
packages installed from a disposable local registry rather than `yalc`-linked. What's kept manual below is
the historical record of the six real runs that first established this exact procedure, before the
automated version existed — not a claim that it still needs to be repeated by hand. The one thing the
automated suite doesn't cover: installing from the _real_ npm registry specifically (its own registry is a
local, disposable one) — that stays one of `docs/domain-glossary.md`'s npm-publishing findings, re-checked
once right before an actual release.

Not automatable in CI _before the automated suite existed_: needed a real Postgres, a real
freshly-scaffolded Medusa v2 application, and (until the packages were published) `yalc` linking instead of
a real `npm install`. The procedure, repeated identically across those six real runs:

1. `docker run -d -e POSTGRES_PASSWORD=... -e POSTGRES_USER=... -e POSTGRES_DB=... -p <port>:5432 postgres:16-alpine`.
2. Build and `yalc publish --private` every workspace package the plugin depends on
   (`einvoice-model`, `einvoice-commerce`, `einvoice-cii`, `einvoice-pdfa`, `einvoice-medusa`, in that
   dependency order).
3. `npx create-medusa-app@<pinned version> <name> --db-url "postgres://..." --use-npm --no-browser` (a
   `create-medusa-app` version, not `@latest` — the scaffold's own shape has changed between versions, most
   notably the turborepo-style `apps/backend/` layout since ~2.19.0, a `docs/domain-glossary.md`
   finding).
4. `yalc add` the five packages in the new app, then a plain `npm install` (not optional — a yalc-linked
   package's _own_ dependencies aren't pulled in by `yalc add` alone, a finding from the standalone-mode run
   recorded in `docs/domain-glossary.md`).
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

## Admin widget, visually

The "E-Invoices" widget's own rendering, layout, and that a download link actually triggers a real request
— none of this is exercised by a unit test (`src/storage.test.ts` etc. test the logic behind it, not the
React component or its wiring into the real Medusa dashboard). Verified by opening the real dashboard in a
browser, logging in as a real admin user, navigating to a real order's page, and confirming: the "E-Invoices"
section appears in the side column with one row per document; each row's download icons issue a real
`GET .../einvoice/:documentId/{xml,pdf}` request (confirm via the browser's own network log — a
`Content-Disposition: attachment` response opened via `target="_blank"` reports as an aborted navigation in
a sandboxed preview browser, which is expected, not a failure of the route itself).

The same page for the two states the check against what Medusa charged adds:
an invoice issued with a notice shows an orange "Refund due" or "VAT differs from Medusa" badge and the
explanation under its row; an invoice not issued shows a red "Invoice not issued" badge, the explanation
and a **Retry** button, which issues `POST .../einvoice/refusals/:refusalId/retry` and reloads the list. To
reach both on a local stand: a Spanish delivery to a business buyer with a verified VAT-ID in a region
charging Spanish VAT (the notice), and an order whose shipping option carries a 0% tax rate override (the
refusal) — the same setup as the end-to-end scenarios S12 and S13.

The rule and the VIES answer: under each document, a small line "VAT
category S · tax-semantics#1" (the reasoning on hover); under an intra-EU invoice (end-to-end scenario S2)
also "VIES: FR… valid on <date> · consultation …".

Codes and support: every notice's and refusal's code, in brackets after the
explanation, opens its anchor on the error reference; a refusal for a buyer in Italy (end-to-end scenario
S17) also shows "Ask for support of this country", which opens the repository's country form with the title,
the seller's and the buyer's country filled in, and nothing sent. **Settings → Store** shows an "E-Invoicing" block below the store details: the
seller country, one line on what the release supports (from `GET /admin/einvoice/support`), and a link to
the error reference.

Exchanges, prices and the PDF: a refused exchange or replacement shipment
shows the red "Invoice not issued" badge with its code (`SHIPMENT_OF_EXCHANGE`, `SHIPMENT_OF_CLAIM_REPLACEMENT`
— end-to-end scenario S22); an invoice whose price an order edit changed shows an orange "Price changed" badge
naming the line by its title and what to do; an invoice issued without its PDF shows an orange "XML only"
badge naming the font (`PDF_FONT_NOT_EMBEDDED` — S23) and no PDF download icon. A credit note's PDF from
`renderInvoicePdf` is titled "Rechnungskorrektur" over "Credit note" and names the invoice it corrects
("zu Rechnung RE-… vom …", "for invoice RE-… of …").

All of the above was last checked on 2026-09-29, Medusa 2.21.0, on the orders the end-to-end scenarios leave
behind — every badge, line, code link and the Retry request as described. The refused Italian invoice (S17)
was checked again on 2026-10-02: its explanation starts with the buyer's country, the Retry button is there,
and "Ask for support of this country" links to the country form with `seller=DE` and `buyer=IT`. The form
itself, on GitHub, was not opened: GitHub shows it only to a signed-in account. How to repeat it:

1. `EINVOICE_E2E_ADMIN=1 pnpm e2e` — the scenarios run against a stand that also serves Medusa's dashboard,
   and the stand is left running with every scenario's orders, the dashboard at `http://localhost:9500/app`
   ([`docs/e2e.md`](e2e.md#with-medusas-dashboard)).
2. Log in with the stand's admin (`e2e/src/harness/env.ts`). The orders are named after their scenario in
   the customer's e-mail (`s12-buyer@…`, `s23-buyer@…`); the order list's search finds them by `s12` etc.
3. `pnpm --filter @normwerk/einvoice-e2e stand:down` removes the stand; so does the next `pnpm e2e`.

The credit note's PDF was checked by its text: `renderInvoicePdf` embeds its fonts with a Unicode map, so the
title and the reference lines can be read out of the file.

No screenshot of this is committed to the repository — the environment this was built in has no accessible
display for a real screenshot (`screencapture` genuinely fails with "could not create image from display",
confirmed, not assumed) and the preview browser tool used has no "save frame to file" capability either.
`docs/features/einvoice-medusa.md` records this same gap plainly.

## Store API ownership check, with real accounts

**Now automated — see [`docs/e2e.md`](e2e.md) (`e2e/src/scenarios/store-ownership.test.ts`).**
`customerOwnsOrder`'s own logic has no dedicated unit test (it's three lines wrapping a `query.graph` call —
the real value is in the end-to-end behavior, not the logic in isolation). `pnpm e2e` now checks all three
real states on every run: no bearer token at all (`401`), a different, genuinely registered customer
(real `POST /auth/customer/emailpass/register` + login, `404` — not `403`, so as not to confirm the order
even exists to a non-owner), and the actual owning customer (`200`, byte-identical file, KoSIT-valid).

## npm/GitHub existence checks

Two real, external, point-in-time facts that no test suite owns:

- **The `@normwerk` npm scope has no currently-published packages** — checked via
  `https://registry.npmjs.org/-/v1/search?text=%40normwerk` returning zero results. Does not by itself
  prove the _organization_ isn't already registered (an npm org can exist with zero published packages);
  only that nothing would collide on first publish.
- **The GitHub repository exists, at `github.com/normwerk/einvoice`** — on 2026-09-16 a push still reported
  the organisation as `Normwerk`; on 2026-09-23 GitHub's API returned the organisation's canonical login as
  `normwerk`, so every package's `repository`/`homepage`/`bugs` field now matches exactly. Neither
  `git remote -v` nor `git ls-remote` can settle casing — the first echoes what a human typed, the second
  succeeds through a redirect without mentioning it (see `docs/domain-glossary.md`). The repository itself
  is currently **private** (GitHub's API returns the same 404 for "private" as for "doesn't exist" to an
  unauthenticated caller); making it public is a deliberate, separate action the maintainer takes.

Re-check both again immediately before the real publish — the name has to be re-checked publicly for any
collision that has appeared since September, a fact that can change between when this file was last updated
and when publish actually happens.

## Third-party license text

`tools/license-scan/scan.mjs` catches an SPDX identifier outside the allow-list automatically, but it
cannot itself judge whether an unusual-looking result (`"UNKNOWN"`, the legacy `"SEE LICENSE IN LICENSE"`
pointer, or a genuinely proprietary notice) is actually fine to accept — that took a human (or an agent
acting as one) opening the real installed package's own `LICENSE`/`package.json` and reading it. Every
override currently in `tools/license-scan/license-policy.mjs`'s own `KNOWN_DEV_LICENSE_OVERRIDES` was
produced this way, individually, not pattern-matched — repeat the same manual read for any _new_ package
that starts failing the scan for one of these reasons before adding it to that map.

## Quickstart, by an actual new developer

The quickstart's own written claim ("about 30 minutes") was timed against a scripted run of the exact same
steps (`docs/quickstart-medusa.md`'s own "How this was verified" section) — a real, useful proxy, but not
the same thing as a person who has never seen this codebase actually following the prose instructions
themselves, hitting whatever a script doesn't (an ambiguous instruction, a missing prerequisite, a copy-paste
error). The requirement before release — a new developer, someone who did not write the code, gets through
the quickstart in 30 minutes — needs an actual person for that reason; not yet done.
