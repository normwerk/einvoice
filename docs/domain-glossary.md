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
- **A summarized fetch of a BT reference page can simply be wrong, even when the page itself is real.**
  While building `einvoice-model` (T-011), a summarized read of a Peppol postal-address page claimed
  BT-40 = "Seller country subdivision" and BT-41 = "Seller country code" — both wrong. Our own vendored
  Schematron directly asserts BR-09: "The Seller postal address (BG-5) shall contain a Seller country code
  (BT-40)", and a raw (non-summarized) fetch of the same Peppol page confirmed BT-41 = "Seller contact
  point". Treat a _summarized_ answer about a specific BT/BG number as a lead to verify via direct quote
  (grep the vendored artifact, or read the raw fetched text yourself), never as the citation itself —
  `tools/codegen/model/generate.mjs`'s artifact cross-check exists specifically to catch this class of
  error before it reaches generated code.
- **`currencyID` may only be set on `ram:TaxTotalAmount`, never on any other `ram:*Amount` element**, under
  the XRechnung CII profile (`CII-DT-031`, in `XRechnung-CII-validation.xsl`, KoSIT/Apache-2.0) — base
  UN/CEFACT CII allows it everywhere, so this is an XRechnung-specific tightening, not obvious from the CII
  XSD alone. Found by running our own serializer output through the real KoSIT validator (T-020).
- **CII caps "Preceding Invoice reference" (BG-3) at one occurrence**, even though the EN 16931 semantic
  model phrases the rule as "**Each** Preceding Invoice reference (BG-3) shall contain..." implying it can
  repeat. `HeaderTradeSettlementType`'s `InvoiceReferencedDocument` element has no
  `maxOccurs="unbounded"` in the CII D16B XSD — a genuine binding limitation of the CII syntax, not
  something the UBL binding necessarily shares. A credit note referencing multiple prior invoices needs a
  different mechanism (out of scope for v0.1's single-reference credit-note scenario).
- **The XRechnung CII profile requires far more than the base EN 16931 rule set** (T-021): a seller contact
  with name, phone, and email (BG-6/BT-41/42/43); seller **and** buyer city/postcode, not just country
  (BT-37/38/52/53); payment instructions (BG-16) on every invoice, not just ones with a bank transfer;
  seller and buyer electronic addresses with an EAS scheme (BT-34/49, `@schemeID` from the CEF EAS code
  list, `BR-CL-25`); and a business process type (BT-23) — this last one and the electronic-address checks
  (`PEPPOL-EN16931-R001/R010/R020`) come from rules KoSIT bundles into the "EN16931 (CII)" Schematron step
  itself, not the XRechnung-specific layer, so they fire even outside the DE profile once validated through
  KoSIT's tooling. None of this is discoverable from the base ConnectingEurope EUPL-1.2 Schematron alone —
  found by serializing real fixtures and reading the KoSIT rejection.
- **`BR-AE-02` (reverse charge) needs identification on _both_ parties**, not just the seller: the seller's
  VAT-ID or tax registration **and** the buyer's VAT-ID or legal registration identifier. Easy to miss
  because `BR-S-02`-style rules for other categories only ever check the seller.
