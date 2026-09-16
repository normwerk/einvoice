# `@normwerk/einvoice-pdfa`

Embeds an EN 16931 CII invoice XML into a PDF as a PDF/A-3b ZUGFeRD/Factur-X hybrid document —
`OutputIntent`, XMP metadata, and the XML attachment, built with `pdf-lib`. Assumes the input PDF is
already PDF/A-eligible (e.g. uses embedded fonts); does not repair a PDF that isn't. Also ships
`renderInvoicePdf`, a minimal, real, font-embedded A4 invoice layout for callers with no PDF renderer of
their own.

Part of [Normwerk/eInvoice](https://github.com/Normwerk/eInvoice), a TypeScript e-invoicing toolkit for
Germany's XRechnung/ZUGFeRD mandate. See that repository for documentation and the full package list.

## License

MIT — see [`LICENSE`](LICENSE).
