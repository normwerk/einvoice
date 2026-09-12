# Domain glossary

Project-specific EN 16931 / XRechnung conventions and pitfalls that are easy to miss and not obvious from
reading the spec alone. See `AGENTS.md` §2 for how this file is used. Back to [`docs/README.md`](README.md).

- **The XRechnung customization ID is a compound URN**, not just a version number:
  `urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0`. It names both the EN 16931
  compliance level and the specific CIUS. Every scenario in the KoSIT validator configuration matches
  documents by this exact string (`s:match` in `scenarios.xml`) — get it wrong and the validator silently
  runs the _wrong_ scenario (or none) instead of failing loudly.
- **A KoSIT Schematron message's `level` does not map to pass/fail.** `BR-DE-TMP-32` (missing delivery
  date / invoicing period) is emitted at `level="information"` on an otherwise fully compliant invoice — the
  top-level `rep:report/@valid` attribute (or the top-level `summary/@status` in Mustang's report) is the
  actual verdict; counting "any message present" as failure produces false negatives. Verified against a
  real KoSIT Validator 1.6.3 run (spike C, T-044).
- **The KoSIT Validator writes its report next to the input file**, not to stdout
  (`<input>-report.xml` and `.html`, same directory) — a read-only mount of the input directory makes the
  validator fail to write the report, not just skip it silently.
- **Both the KoSIT Validator and Mustang exit non-zero for a _rejected_ document**, not only for a tool
  crash — treat "process exited with an error" and "document is invalid" as the same signal, but still
  parse the emitted report/JSON rather than trusting the exit code alone (a crash produces no report).
- **veraPDF's JSON output nests `validationSummary` under `report.batchSummary`**, not at the top level of
  `report` — easy to miswire when parsing the CLI's `--format json` output.
