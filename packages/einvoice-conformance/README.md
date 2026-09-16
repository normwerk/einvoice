# `@normwerk/einvoice-conformance`

Needs [Docker](https://www.docker.com/) — this package drives the official EN 16931/XRechnung validators
(KoSIT, Mustang, veraPDF), which run as JVM-based Docker images, not pure JavaScript. There is no pure-JS
EN 16931 validator.

Dev tooling: runs those validators against a file and parses their reports into a single, machine-readable
JSON shape. Never a runtime dependency of anything this project ships — it's the tool the other packages'
own CI and conformance suites use to prove their output is actually accepted, not just well-formed.

```bash
docker compose -f docker/compose.conformance.yml build
node dist/cli.js validate <file.xml|file.pdf>
```

Part of [Normwerk/eInvoice](https://github.com/Normwerk/eInvoice), a TypeScript e-invoicing toolkit for
Germany's XRechnung/ZUGFeRD mandate (with `@normwerk/einvoice-medusa` as the first platform adapter, for
Medusa v2). See that repository for the Docker setup (`docker/`), the full conformance gate
(`AGENTS.md` §8), and the package list.

## License

MIT — see [`LICENSE`](LICENSE).
