# eInvoice

MIT-licensed TypeScript core for structured e-invoices ([EN 16931](https://en.wikipedia.org/wiki/EN_16931)), with thin adapters for [Medusa](https://medusajs.com/) v2 and [Vendure](https://www.vendure.io/).

**Status: pre-alpha.** The monorepo is being scaffolded; no package is published or usable yet. See [`docs/README.md`](docs/README.md) for the documentation index and current state.

## Packages (planned)

| Package                          | Purpose                                                         |
| -------------------------------- | --------------------------------------------------------------- |
| `@normwerk/einvoice-model`       | Generated EN 16931 types, code lists, JSON Schema               |
| `@normwerk/einvoice-cii`         | UN/CEFACT CII D16B serializer and profiles (XRechnung, ZUGFeRD) |
| `@normwerk/einvoice-ubl`         | OASIS UBL 2.1 serializer (planned for a later release)          |
| `@normwerk/einvoice-pdfa`        | PDF/A-3b assembly with an embedded invoice XML                  |
| `@normwerk/einvoice-commerce`    | Order/refund → EN 16931 tax semantics (platform-agnostic)       |
| `@normwerk/einvoice-conformance` | Dev tooling: runs official validators against fixtures          |
| `@normwerk/einvoice-medusa`      | Medusa v2 adapter                                               |

## Development

Requires Node.js 22 LTS and pnpm 9.

```bash
pnpm install
pnpm build
pnpm typecheck
pnpm test
```

Running the conformance validators additionally requires Docker:

```bash
docker compose -f docker/compose.conformance.yml build
pnpm conformance validate <file.xml|file.pdf>
```

See [`docs/README.md`](docs/README.md) for more.

## License

MIT — see [`LICENSE`](LICENSE).

## Commercial support

Contact: `__________` (placeholder — not yet set up).
