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

One command. It publishes this repo's own packages to a disposable local registry (Verdaccio, torn down
with everything else afterward), builds and boots a real Medusa v2 app that installs them from there,
drives it through the real Admin/Store HTTP APIs — a cart, an order, a fulfillment, a refund — and checks
the e-invoice XML/PDF it produces against the real KoSIT Validator and veraPDF, the same tools
[`docs/README.md`](README.md#conformance-validators) uses for the fixture suite.

**About 5 minutes** on a laptop (measured across several full runs: best case ~260s, typical ~300-310s),
most of it a real `npm install` of the Medusa app itself (this stand's own `e2e/docker/Dockerfile` doesn't
cache that step — see its own comment for why: caching it risked silently testing a stale build of this
very plugin instead of what you just published). Slower on a slower or more loaded machine — running it
back-to-back with no pause between runs (as CI does) measurably slows every step.

## What you'll see

`vitest`'s own summary, one line per check:

```
✓ src/scenarios/s1-de-domestic.test.ts       — domestic B2B invoice, KoSIT + veraPDF green
✓ src/scenarios/s2-cross-border-vat-id.test.ts — intra-EU B2B with a VAT-ID, category K
✓ src/scenarios/s4-credit-note.test.ts       — a refund produces a credit note referencing the invoice
✓ src/scenarios/idempotency.test.ts          — redelivering an event never creates a duplicate document
✓ src/scenarios/store-ownership.test.ts      — only the order's own customer can download its file
✓ src/scenarios/incomplete-config.test.ts    — the plugin refuses to boot with a missing required option
✓ src/scenarios/tarball-contents.test.ts     — no test/fixture files leak into any published package
```

Every container is torn down automatically when the run finishes, pass or fail — nothing is left behind on
your machine (`docker ps` should show nothing from this afterward).

## If it fails

- **A container never becomes healthy / the run times out**: check `e2e/.artifacts/medusa.log` (and
  `postgres.log`, `verdaccio.log`) — written after every run, not only on failure — for the real container
  output.
- **Port already in use**: this stand uses `55432` (Postgres), `4873` (Verdaccio), and `9500` (Medusa,
  deliberately not `9000`) on the host by default; override with `EINVOICE_E2E_POSTGRES_PORT` /
  `EINVOICE_E2E_VERDACCIO_PORT` / `EINVOICE_E2E_MEDUSA_PORT` if any of those collide with something else
  already running.
- **Still stuck**: [open an issue](https://github.com/normwerk/einvoice/issues) with the log files above
  attached — real container logs are far more useful here than a description of what happened.

## What this doesn't cover yet

This is the `fast` profile only: a committed, pinned Medusa v2 app
(`create-medusa-app@2.19.0`, `e2e/app/`), not a freshly scaffolded one. It catches wiring bugs (does a real
order's data reach the plugin and come back out correctly?), not Medusa scaffold drift or compatibility
with Medusa versions other than the one this app pins. A `fresh` profile against a newly scaffolded app,
and a matrix against multiple Medusa versions, are tracked as follow-up work, not implemented here.

VAT category logic itself (which category a given order should get) is deliberately **not** re-tested
here — that's [`packages/einvoice-medusa/fixtures/tax-matrix`](../packages/einvoice-medusa/fixtures/tax-matrix)'s
job, fast and fixture-driven. This suite only proves that a real order's data survives the trip through a
real Medusa instance to a real, validator-checked document — duplicating tax-category coverage here would
just be a slower, more brittle copy of that suite.
