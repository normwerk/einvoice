# @normwerk/einvoice-conformance

## 0.1.0

### Minor Changes

- First release. A command-line wrapper around the official validators, run in Docker:
  `pnpm conformance validate <file>` checks an XML document with the KoSIT Validator, or a PDF with veraPDF,
  and reports the verdict as JSON. Development tooling only: nothing shipped depends on it at runtime.
