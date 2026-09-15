# `@normwerk/einvoice-commerce`

Maps an order/refund plus tax context to EN 16931 invoice/credit-note semantics — VAT category decisions,
sequential numbering, profile selection (EN 16931 vs. Germany's XRechnung CIUS). Platform-agnostic: no
Medusa or Vendure types live here; `@normwerk/einvoice-medusa` is the Medusa-specific adapter built on top
of it.

Part of [normwerk/eInvoice](https://github.com/normwerk/eInvoice), a TypeScript e-invoicing toolkit for
Germany's XRechnung/ZUGFeRD mandate. See that repository for documentation, the tax-semantics reference,
and the full package list.

## License

MIT — see [`LICENSE`](LICENSE).
