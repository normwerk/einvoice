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

Medusa 2.19.0 or later within 2.x (the peer dependencies ask for `^2.19.0`). Each release below was run
through the end-to-end suite — a real store, from checkout to a validated invoice, credit note and refund:

| Medusa | End-to-end suite | Note                                                                                                           |
| ------ | ---------------- | -------------------------------------------------------------------------------------------------------------- |
| 2.21.1 | 22/22            |                                                                                                                |
| 2.21.0 | 22/22            | The suite's default                                                                                            |
| 2.20.1 | 22/22            |                                                                                                                |
| 2.19.0 | 22/22            | Also the version the plugin is developed and unit-tested against                                               |
| 2.18.0 | 14/22            | Shipping is missing from the invoice, so it totals less than was charged                                       |
| 2.17.2 | 9/22             | Order lines reach the plugin without their tax lines: every domestic order is refused                          |
| 2.16.0 | 9/22             | As 2.17.2                                                                                                      |
| 2.12.6 | 12/22            | Shipping is missing from the invoice; a refund gives no credit note (the order cannot be looked up by payment) |

Below 2.19 the order totals and shipping amounts the plugin reads from Medusa are not there, and nothing
older was made to work: the peer dependencies stop an npm install below 2.19.0.

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
