# @normwerk/einvoice-conformance

## 0.1.0

### Minor Changes

- First public release (v0.1.0): a command-line wrapper around the official validators, run in Docker —
  `pnpm conformance validate <file>` checks an XRechnung/EN 16931 XML document with the KoSIT Validator and
  reports its verdict. Development tooling only: nothing shipped depends on it at runtime.
