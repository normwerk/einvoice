# Try it yourself: the end-to-end suite

Back to [`docs/README.md`](README.md). This runs a real Medusa v2 store — installed from a real npm
registry, never linked into this monorepo's own workspace — through a real order, and checks the resulting
e-invoice against the same official validators (KoSIT, veraPDF) the fixture-based conformance suite uses.
If you want to see this plugin work end to end on your own machine rather than take the README's word for
it, this is that command.

## Prerequisites

- Docker, with Compose v2 (`docker compose version`).
- About 2 GB of free memory for the containers (Postgres, Redis, Verdaccio, and a full Medusa v2 app).
- Node 22+ and pnpm 9 (the same versions [`README.md`](../README.md#development) asks for), to drive the
  suite itself — nothing inside the containers needs your local Node install.

## Run it

```bash
pnpm install
pnpm e2e
```

One command. It builds this repo's own packages and publishes them to a disposable local registry (Verdaccio,
torn down with everything else afterward), builds and boots a real Medusa v2 app that installs them from there,
drives it through the real Admin/Store HTTP APIs — a cart, an order, a fulfillment, a refund — and checks
the e-invoice XML/PDF it produces against the real KoSIT Validator and veraPDF, the same tools
[`docs/README.md`](README.md#conformance-validators) uses for the fixture suite.

**About 3-4 minutes** on a laptop (measured across three full runs, strictly back-to-back with no pause:
244s / 220s / 193s), most of it a real `npm install` of the Medusa app itself (this stand's own
`e2e/docker/medusa/Dockerfile` doesn't cache that step — see its own comment for why: caching it risked
silently testing a stale build of this very plugin instead of what you just published). Back-to-back runs
did not get slower. Why the three runs differ is not established — it is not a registry cache: Verdaccio's
storage is a tmpfs, wiped with the stand after every run. An earlier version of this note claimed back-to-back
runs measurably slow down; that was this suite's own flake (see "If it fails" below), not a property of
running it repeatedly.

## What you'll see

`vitest`'s own summary, one line per check:

```
✓ src/scenarios/s1-de-domestic.test.ts       — domestic B2B invoice, KoSIT + veraPDF green
✓ src/scenarios/s2-cross-border-vat-id.test.ts — intra-EU B2B with a VAT-ID, category K
✓ src/scenarios/s4-credit-note.test.ts       — a refund produces a credit note referencing the invoice
✓ src/scenarios/s5-partial-refund.test.ts    — a partial refund is credited for its own amount, one line
✓ src/scenarios/s6-cancel-after-invoice.test.ts — cancelling an invoiced order reverses the invoice
✓ src/scenarios/s7-promotion.test.ts         — a promotion code becomes a line discount named after it
✓ src/scenarios/s8-service-reverse-charge.test.ts — a services-only order to an EU business, category AE
✓ src/scenarios/s9-b2c-guest.test.ts         — a private guest buyer, named from the billing address
✓ src/scenarios/s10-prices-incl-vat.test.ts  — prices including VAT: the invoice totals what was charged
✓ src/scenarios/s11-b2g-leitweg-id.test.ts   — a public-sector buyer's Leitweg-ID: BT-10 and the XRechnung profile
✓ src/scenarios/s12-vat-overcharged-notice.test.ts — VAT charged that a K invoice does not state: issued with a refund-due notice; refunding it credits nothing
✓ src/scenarios/s13-blocked-then-retried.test.ts   — an invoice stating more VAT than was charged: not issued, the order corrected, retried; a refund meanwhile credited on retry
✓ src/scenarios/s14-vies-unavailable-retried.test.ts — VIES unavailable: the invoice refused and recorded, the VAT-ID confirmed by hand, retried
✓ src/scenarios/s15-mixed-rates.test.ts       — a 7 % / 19 % basket: shipping split per rate, a received return credited at its rate, a goodwill refund and a cancellation credited per rate
✓ src/scenarios/idempotency.test.ts          — delivering an event a second time never creates a duplicate document
✓ src/scenarios/store-ownership.test.ts      — only the order's own customer can download its file
✓ src/scenarios/incomplete-config.test.ts    — the plugin refuses to boot without a required option, or with a seller outside Germany
✓ src/scenarios/tarball-contents.test.ts     — no test/fixture files leak into any published package
```

Every invoice is also compared with what Medusa charged (`order.tax_total`, `order.total`) before it is
issued, so the stand charges real VAT: its German tax region carries the 19% standard rate, and its Spanish
one 21% — Medusa's built-in tax provider knows nothing of the intra-EU reverse charge, so a Spanish
business buyer is charged VAT the invoice does not state (S12). The other countries carry no rate, so a
French business buyer is charged no VAT, which is what category K and AE invoices show. S13 adds a 0% rate
for the shipping option in Germany for its own run, S15 a 7% rate for the sweatpants (standing in for a
book), and S16 the same 0% shipping rate with the region's prices switched to include VAT, and each removes
it again. The stand's clock is fixed (`EINVOICE_E2E_NOW`, 2026-01-15 by
default), so every document carries the same date on every run.

Every container is torn down both before a run starts and after it finishes — pass, fail, or even a
previous run that got killed outright (closed terminal, `kill -9`, a cancelled CI job) — so `docker ps`
should show nothing from this stand at any point you're not actively mid-run.

## If it fails

- **A container never becomes healthy / the run times out**: check `e2e/.artifacts/medusa.log` (and
  `postgres.log`, `verdaccio.log`) — written after every run, and before the stand is torn down when it
  fails to come up — for the real container output.
- **`npm install` inside the `medusa` container fails with `ERESOLVE`**: some `@medusajs/*` package resolving
  to a newer Medusa patch than the exact version this app pins (`@medusajs/framework`) — this app installs
  fresh from the real npm registry (proxied through the stand's own Verdaccio) on every boot, so a new
  upstream release can start failing this install with no change on our side. It was first seen through
  `@medusajs/test-utils`, which `@normwerk/einvoice-medusa` used to declare as a required peer dependency;
  the plugin no longer does (it is a test tool, not something a shop needs), and `e2e/app/package.json` pins
  it to the same version as `@medusajs/framework`. If it recurs after a Medusa release, bump the pinned
  `@medusajs/*` versions together. `e2e/app` has no lockfile on purpose: the `@normwerk/*` packages are
  rebuilt and republished for every run, so their integrity hashes change each time and a committed lock
  would fail the install. The Medusa packages are pinned exactly instead; everything below them resolves
  fresh, as on a shop's first install.
- **Port already in use**: this stand uses `55432` (Postgres), `4873` (Verdaccio), and `9500` (Medusa,
  deliberately not `9000`) on the host by default; override with `EINVOICE_E2E_POSTGRES_PORT` /
  `EINVOICE_E2E_VERDACCIO_PORT` / `EINVOICE_E2E_MEDUSA_PORT` if any of those collide with something else
  already running.
- **To look inside the failing stand**: `EINVOICE_E2E_KEEP_STAND=1` leaves it running after the run
  (`docker exec einvoice-e2e-medusa-1 …`); the next run removes it first.
- **Still stuck**: [open an issue](https://github.com/normwerk/einvoice/issues) with the log files above
  attached — real container logs are far more useful here than a description of what happened.

## Another Medusa release

```bash
EINVOICE_E2E_MEDUSA_VERSION=2.19.0 pnpm e2e
```

runs the same suite against another Medusa release. The harness copies `e2e/app/` to a temporary directory,
sets every `@medusajs/*` package to that version (dropping one the release does not have yet) and the UI
and router packages to what that release's own dashboard depends on, and builds the stand from the copy;
the committed app is left alone. A release outside the plugin's supported ones
(`packages/einvoice-medusa/src/medusa-version.ts`) is installed with `--legacy-peer-deps`, with the
non-optional peer dependencies of that release's Medusa packages added to the app the way its own scaffold
listed them — and there the plugin refuses to start, so the stand never becomes healthy and
`e2e/.artifacts/medusa.log` shows `UnsupportedMedusaVersionError`. That is the expected result for such a
release. A supported release whose own packages npm cannot install strictly — 2.14.2, where
`@medusajs/icons` requires React 19 and the dashboard React 18 — is installed with `--legacy-peer-deps` too,
as a shop on it has to (`MEDUSA_PEER_CONFLICTS`, `e2e/src/harness/medusa-version.ts`). The versions actually installed are printed at the start of
the run and written to `e2e/.artifacts/versions.txt`.

Results so far are in the plugin's compatibility table
([`packages/einvoice-medusa/README.md`](../packages/einvoice-medusa/README.md#compatibility)).

## What this doesn't cover yet

This is the `fast` profile only: a committed Medusa v2 app (`e2e/app/`, scaffolded with
`create-medusa-app@2.19.0`, its `@medusajs/*` packages pinned to 2.21.0), not a freshly scaffolded one. It catches wiring bugs (does a real
order's data reach the plugin and come back out correctly?), not Medusa scaffold drift. Other Medusa
releases run on the same committed app (above), so a release whose own scaffold differs more than
package versions can need changes to the stand before its result says anything about the plugin. A
`fresh` profile against a newly scaffolded app, and a scheduled run across releases, are follow-up work.

VAT category logic itself (which category a given order should get) is deliberately **not** re-tested
here — that's [`packages/einvoice-medusa/fixtures/tax-matrix`](../packages/einvoice-medusa/fixtures/tax-matrix)'s
job, fast and fixture-driven. This suite only proves that a real order's data survives the trip through a
real Medusa instance to a real, validator-checked document — duplicating tax-category coverage here would
just be a slower, more brittle copy of that suite.
