# `@normwerk/einvoice-cii`

Serializes an `Invoice` (`@normwerk/einvoice-model`) to UN/CEFACT Cross Industry Invoice (CII) D16B XML,
with XRechnung 3.0 and ZUGFeRD profile support. Deterministic output (byte-stable for the same input — no
`Date.now()`, no floating-point summation, fixed element order from a generated serialization plan).

Part of [normwerk/einvoice](https://github.com/normwerk/einvoice), a TypeScript e-invoicing toolkit for
Germany's XRechnung/ZUGFeRD mandate. See that repository for documentation, the model → CII XPath mapping
reference, and the full package list.

## License

MIT — see [`LICENSE`](LICENSE).
