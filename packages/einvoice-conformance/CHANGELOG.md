# @normwerk/einvoice-conformance

## 0.1.0

### Minor Changes

- First release. A command-line wrapper around the official validators, run in Docker:
  `pnpm conformance validate <file>` checks an XML document with the KoSIT Validator, or a PDF with veraPDF,
  and reports the verdict as JSON. Development tooling only: nothing shipped depends on it at runtime.
  `npx @normwerk/einvoice-conformance dry-run <folder>` is the second step of the Medusa plugin's dry run: it
  validates the invoices' XML with KoSIT and Mustang and writes the report as Markdown. The report's format —
  its JSON types and its Markdown — is exported from the package.
