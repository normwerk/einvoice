# `@normwerk/einvoice-medusa`

A thin Medusa v2 plugin for German e-invoicing (XRechnung 3.0 / ZUGFeRD, EN 16931): subscribes to
`order.fulfillment_created` and `payment.refunded`, maps the order to
[`@normwerk/einvoice-commerce`](https://www.npmjs.com/package/@normwerk/einvoice-commerce)'s invoice model,
and stores the result — idempotently, with no duplicate documents on event redelivery. No tax logic and no
XML live in this package; that's `@normwerk/einvoice-commerce`/`@normwerk/einvoice-cii`'s job, kept
platform-agnostic.

Two PDF modes: reuse an already-installed PDF plugin's own invoice (`@webbers/invoices-medusa`), or
generate PDF/A-3 standalone from any PDF renderer you supply (including a bundled one,
[`@normwerk/einvoice-pdfa`](https://www.npmjs.com/package/@normwerk/einvoice-pdfa)'s `renderInvoicePdf`).
Documents are stored in Medusa's own File Module (private), with an admin "E-Invoices" widget on the order
page and a Store API endpoint for a customer to fetch their own e-invoice.

## Compatibility

Supported: Medusa **2.12–2.15 and 2.18 or later 2.x** — the releases the end-to-end suite passes on (a real
store, from checkout to a validated invoice, credit note and refund), each minor line run at its latest
patch. The peer dependencies declare exactly that range, and on any other release the plugin refuses to
start (`UnsupportedMedusaVersionError`) rather than run where it has not been shown to issue correct
invoices. Need another release? A pull request is welcome, or write to hello@normwerk.dev about adapting
it.

| Medusa         | End-to-end suite | Supported | Note                                                                                                                                                                                                                                    |
| -------------- | ---------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2.21.1         | 25/25            | yes       |                                                                                                                                                                                                                                         |
| 2.21.0         | 25/25            | yes       | The suite's default                                                                                                                                                                                                                     |
| 2.20.1         | 25/25            | yes       |                                                                                                                                                                                                                                         |
| 2.19.0         | 25/25            | yes       | Also the version the plugin is developed and unit-tested against                                                                                                                                                                        |
| 2.18.0         | 25/25            | yes       |                                                                                                                                                                                                                                         |
| 2.16.0, 2.17.2 | —                | no        | The plugin refuses to start. Before it did, the suite passed 10 of its then 22 checks there: Medusa charged no VAT on the products in the test store, only on shipping, so every domestic order was refused. Cross-border orders passed |
| 2.15.5         | 25/25            | yes       |                                                                                                                                                                                                                                         |
| 2.14.2         | 25/25            | yes       | npm installs Medusa 2.14.2 itself only with `--legacy-peer-deps`, plugin or not: `@medusajs/icons@2.14.2` requires React 19, Medusa's own dashboard 2.14.2 React 18                                                                     |
| 2.13.6         | 25/25            | yes       |                                                                                                                                                                                                                                         |
| 2.12.6         | 25/25            | yes       |                                                                                                                                                                                                                                         |
| below 2.12     | —                | no        | Not run: the test store does not start on these releases yet                                                                                                                                                                            |

Invoices and credit notes are issued for a seller in Germany only; the plugin refuses to start with any
other seller country. Buyers can be in Germany (businesses, consumers, public-sector buyers), elsewhere in
the EU/EEA except Italy and Poland (their clearance platforms take no EN 16931 document), Switzerland or
the UK.

## Install

```bash
npm install @normwerk/einvoice-medusa @normwerk/einvoice-model @normwerk/einvoice-commerce @normwerk/einvoice-cii
```

Full setup — configuration, migrations, optional PDF modes — is the
[quickstart](https://github.com/normwerk/einvoice/blob/main/docs/quickstart-medusa.md): about 30 minutes
from a fresh `create-medusa-app` project to a KoSIT-validated invoice on your first fulfilled order.

## Documentation

Part of [normwerk/einvoice](https://github.com/normwerk/einvoice). See that repository for:

- [Quickstart](https://github.com/normwerk/einvoice/blob/main/docs/quickstart-medusa.md)
- [Medusa field → BT/BG mapping reference](https://github.com/normwerk/einvoice/blob/main/docs/mapping-reference-medusa.md)
- [Storage, admin widget, Store API design](https://github.com/normwerk/einvoice/blob/main/docs/features/einvoice-medusa.md)
- [Domain glossary — every real Medusa v2 gotcha found building this](https://github.com/normwerk/einvoice/blob/main/docs/domain-glossary.md)

## License

MIT — see [`LICENSE`](LICENSE).
