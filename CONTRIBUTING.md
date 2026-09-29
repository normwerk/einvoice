# Contributing

Thank you for helping. Issues and pull requests get a first answer within three business days.

- A bug: open an issue with the bug form. Use synthetic data only — never paste a real invoice, a customer's
  name, address, VAT-ID or bank details.
- A country or document profile you need: open an issue with the country form. The
  [country roadmap](README.md#country-roadmap) shows what is planned; requests decide what comes next.
- A vulnerability: not in an issue — see [`SECURITY.md`](SECURITY.md).
- Anything larger than a small fix: open an issue first. The scope is deliberately narrow, and every profile
  and platform version added is maintained for good.

Everyone taking part follows the [code of conduct](CODE_OF_CONDUCT.md).

## Setup

Node.js 22 or newer, pnpm 9, and Docker for the validators and the end-to-end suite.

```bash
pnpm install
pnpm build
pnpm typecheck
pnpm lint
pnpm format
pnpm test
```

The official validators run in Docker — see [`docs/test-cases.md`](docs/test-cases.md) for every suite and
the command that runs it, and [`docs/e2e.md`](docs/e2e.md) for the end-to-end suite (`pnpm e2e`).

## What a pull request needs

- **A test that failed before the change.** A new scenario ships with a fixture.
- **Every check green.** Unit tests, typecheck, lint, formatting and the licence scan (`pnpm license-scan`)
  always. A change to `einvoice-model`, `einvoice-cii`, `einvoice-ubl`, `einvoice-pdfa` or
  `einvoice-commerce` also needs the conformance suites green — all fixtures, not a pass rate; CI runs them
  on every pull request. A difference against the independent generators is never dismissed: classify it —
  our bug, theirs, or a permissible variation, with the rule behind the verdict — in the oracle script under
  `tools/conformance/`, so that the committed report
  ([`docs/l4-oracle-eu-report.md`](docs/l4-oracle-eu-report.md),
  [`docs/l4-oracle-facturx-report.md`](docs/l4-oracle-facturx-report.md)) carries it.
- **Tax decisions in `einvoice-commerce` only.** The format packages turn a model into bytes, and the
  Medusa adapter maps Medusa's data to the commerce input; neither decides a VAT category. The core packages
  are pure: no clock, randomness, network or file access — pass such values in.
- **Generated files untouched by hand.** Change the generator or its source artifact, run `pnpm codegen`
  and commit what it produces. A new official artifact is recorded in [`docs/sources.md`](docs/sources.md)
  with its source, version and hash.
- **Runtime dependencies under MIT, Apache-2.0, BSD or ISC only**, and no third-party e-invoicing library at
  runtime.
- **Synthetic data only**, with obviously fake identities such as `Musterfirma GmbH`. Invoice contents are
  never logged at info level or above.
- **Docs for what changed.** A changed contract or behaviour updates its page under [`docs/`](docs/README.md)
  in the same pull request; a new test updates [`docs/test-cases.md`](docs/test-cases.md).
- **A changeset** (`pnpm changeset`) when a published package changes in a way its users notice.
- **English** in code, comments, docs and commit messages.

[`AGENTS.md`](AGENTS.md) holds the full working rules behind this list — the layers, the conformance levels,
generated code — and AI coding agents working in this repository follow it.

## Licence

Contributions are accepted under the project's [MIT licence](LICENSE).
