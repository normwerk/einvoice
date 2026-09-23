# Artifact sources and licensing

Every official artifact used to generate or validate code in this repository is recorded here and in
[`artifacts/MANIFEST.json`](../artifacts/MANIFEST.json), per `AGENTS.md` §5.1 and §9. Every entry has a URL,
version and licence, and a SHA-256 hash — every vendored artifact, and the XRechnung Schematron release
archive, which is not vendored. Four entries have none, each with its reason in `unpinned_reason`: Peppol
BIS Billing 3.0, the EN 16931 code list registry and the ZUGFeRD/Factur-X specification are references no
build or check reads, and Mustang's XMP writer is pinned by git commit, with the hashes of the files read
recorded next to it.

**Why this document exists.** EN 16931-1 (the semantic data model) and EN 16931-3-2 / -3-3 (the UBL/CII
syntax binding tables) are paid CEN standards sold by national bodies (DIN/Beuth, NEN, SFS, …). This
repository is MIT-licensed and public from its first commit (`AGENTS.md` §5.1: zero third-party
e-invoicing libraries in runtime, our own serializers only). Before generating a single line of binding
code, we needed to know whether a complete BT/BG → XPath binding for CII and XRechnung is reconstructable
from **freely usable, redistributable** artifacts alone — without buying or redistributing the paid
standard texts. That question was researched on 2026-09-12; the findings follow.

## Findings

| Source                                                                                                                                                                                                                                                                                            | What it provides                                                                                        | Licence (as verified)                                                                                                                                                                                                                                          | Verdict                                                                                                                                                                                                |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [ConnectingEurope/eInvoicing-EN16931](https://github.com/ConnectingEurope/eInvoicing-EN16931)                                                                                                                                                                                                     | Schematron business rules (BR-\*, BR-CO-\*, …) for UBL and CII, the CII D16B XSD, codelists, test files | **EUPL-1.2** (repo `LICENSE.txt`, confirmed by direct fetch)                                                                                                                                                                                                   | **Can vendor**, unmodified, with the licence text kept alongside (EUPL copyleft applies to modifications)                                                                                              |
| [KoSIT / xeinkauf.de](https://xeinkauf.de/xrechnung/) — [validator-configuration-xrechnung](https://github.com/itplr-kosit/validator-configuration-xrechnung), [xrechnung-schematron](https://github.com/itplr-kosit/xrechnung-schematron), [validator](https://github.com/itplr-kosit/validator) | German XRechnung CIUS: Schematron rules, validator engine + configuration bundle, codelists, test suite | **Apache-2.0** for all three GitHub repos (confirmed via GitHub API `license.spdx_id`)                                                                                                                                                                         | **Can vendor/use** the machine-readable artifacts. The XRechnung specification **PDF** itself derives from EN 16931-1 under DIN's royalty-free licensing — link to it, do not vendor it                |
| [OASIS UBL 2.1](https://docs.oasis-open.org/ubl/os-UBL-2.1/UBL-2.1.html)                                                                                                                                                                                                                          | Full UBL 2.1 XSD schema set                                                                             | **OASIS IPR/Notices**: copying and derivative works permitted, unmodified, with the copyright notice retained                                                                                                                                                  | **Can vendor**, unmodified, notice retained. Deferred to v0.2 (`einvoice-ubl`)                                                                                                                         |
| UN/CEFACT D16B CII XSD (via [ConnectingEurope's copy](https://github.com/ConnectingEurope/eInvoicing-EN16931/tree/master/cii/schema))                                                                                                                                                             | The CII XSD itself                                                                                      | UN/CEFACT's standard document notice is reported to permit unrestricted implementation copies with attribution, but we could not re-verify this by fetching a live `unece.org` page in this session (got HTTP 403)                                             | We use the **ConnectingEurope EUPL-1.2 copy** of this XSD instead of going to UN/CEFACT directly — same bytes, clearer licence chain                                                                   |
| [OpenPeppol BIS Billing 3.0](https://github.com/OpenPEPPOL/peppol-bis-invoice-3)                                                                                                                                                                                                                  | UBL BT→XPath binding guide, Schematron, codelists                                                       | **Unclear.** No `LICENSE` file in the repo; the rendered spec at [docs.peppol.eu](https://docs.peppol.eu/poacc/billing/3.0/bis/) states the document "may not be modified, re-distributed, sold or repackaged … without the prior consent of OpenPeppol AISBL" | **Read-only.** Use it to derive our own mapping notes; do not commit its `.sch`/codelist files verbatim. Out of scope for v0.1 anyway (UBL/Peppol is v0.2)                                             |
| [EN 16931 codelist registry](https://ec.europa.eu/digital-building-blocks/sites/spaces/DIGITAL/pages/467108957/Code+lists) (EC Digital Building Blocks)                                                                                                                                           | UNCL1001/5305/4461, EAS, ICD, ISO 4217/3166 code list values                                            | **Unclear.** No licence/terms-of-use statement found on the registry page itself                                                                                                                                                                               | Prefer the already-open mirrors of the same code lists inside the ConnectingEurope (EUPL-1.2) or OpenPEPPOL repos over the raw EC files                                                                |
| [ZUGFeRD / Factur-X](https://www.ferd-net.de/en/standards/zugferd/factur-x) (FeRD / FNFE-MPE)                                                                                                                                                                                                     | Spec ZIP: PDF, XSD, Schematron, code lists, samples for all profiles                                    | **Unclear.** No licence/terms-of-use text found on the official download page                                                                                                                                                                                  | Not needed directly: we generate our own CII XML and embed it into PDF/A-3b rather than starting from FeRD's schema files. Feasibility confirmed by an internal PDF/A spike (see [`pdfa.md`](pdfa.md)) |

This table summarises the research (URLs fetched, exact quotes, and the reasoning above) to what matters
for engineering decisions.

## Conclusion

A complete, freely usable BT/BG → XPath binding for **CII and XRechnung** — the v0.1 scope — is
reconstructable end to end from the ConnectingEurope (EUPL-1.2) and KoSIT (Apache-2.0) artifacts alone,
without purchasing or redistributing EN 16931-1 / -3-2 / -3-3. Schematron rules are themselves a de facto
BT → XPath binding (each rule's `context` attribute is an XPath assertion against the CII/UBL tree), so
reading them is sufficient to derive the mapping.

The residual gaps — Peppol BIS's redistribution terms, the EC codelist registry's silence on licensing, and
ZUGFeRD/Factur-X's spec ZIP — do not block v0.1: UBL/Peppol is v0.2 scope, the codelist values are
consumed via their already-open mirrors, and ZUGFeRD is planned as "generate CII, embed in PDF" rather than
needing FeRD's own schema files.

The binding is therefore reconstructed from free derivative artifacts, with no need to purchase the paid
standards for the v0.1 scope.

## Vendored artifacts

See [`artifacts/MANIFEST.json`](../artifacts/MANIFEST.json) for the authoritative, machine-readable list.
Currently vendored (copied into `artifacts/` with a matching `sha256`):

- `artifacts/cii-d16b/schema/CrossIndustryInvoice_100pD16B.xsd` — CII D16B root XSD (EUPL-1.2)
- `artifacts/cii-d16b/schema/CrossIndustryInvoice_ReusableAggregateBusinessInformationEntity_100pD16B.xsd`,
  `..._QualifiedDataType_100pD16B.xsd`, `..._UnqualifiedDataType_100pD16B.xsd` — the complex/leaf type
  definitions the root XSD imports (EUPL-1.2), needed to get element sequence order and attribute names
  right for the CII serializer
- `artifacts/cii-d16b/schematron/EN16931-CII-validation-preprocessed.sch` — composed EN 16931 CII business
  rules (EUPL-1.2)
- `artifacts/cii-d16b/schematron/EN16931-CII-codes.sch` — EN 16931 codelist restrictions (VAT category,
  VATEX, ISO 4217/3166, UNTDID 1001/4461, ISO 6523 ICD, …), EUPL-1.2

The XRechnung validator configuration and Schematron bundles (Apache-2.0) are recorded but not vendored —
they are consumed by the Docker-based conformance tooling, not by the codegen pipeline.

- `artifacts/pdfa/sRGB2014.icc` — sRGB ICC v2 profile for the PDF/A-3b `OutputIntent`
  (`einvoice-pdfa`). Copyright International Color Consortium; licensed for unrestricted copying,
  distribution, and embedding (see `artifacts/LICENSES/ICC-sRGB2014.txt` for the verbatim terms and real,
  curl-verified download URL — an earlier URL for this file returned 404 and was caught before committing
  it). Replaces the unlicensed macOS system sRGB profile the internal PDF/A spike used for local
  experimentation only.

Two further sources for `einvoice-pdfa` are recorded in the manifest but not vendored: real,
Apache-2.0-licensed source files from [ZUGFeRD/mustangproject](https://github.com/ZUGFeRD/mustangproject)
(the same tool already used as a Docker conformance validator), read directly to get the exact
ZUGFeRD/Factur-X XMP namespace URNs, the required `pdfaExtension:schemas` RDF structure (ISO 19005-3
Annex E), and the exact accepted XMP property values — rather than guessed or reconstructed from the
(licence-unclear, not-vendored) ZUGFeRD/Factur-X spec ZIP above.

- `artifacts/fonts/LiberationSans-{Regular,Bold}.ttf` — real font, embedded (subset) into the visual invoice
  layout `einvoice-pdfa` renders (`render-invoice.ts`), closing the "non-embedded standard font" PDF/A gap
  the internal PDF/A spike diagnosed for a blank test page. SIL Open Font License 1.1
  (`artifacts/LICENSES/OFL-LiberationSans.txt`, the exact license text from inside the vendored tarball) —
  explicitly permits embedding/redistribution. Real, curl-downloaded tarball
  (`liberation-fonts-ttf-2.1.5.tar.gz`, sha256 in `artifacts/MANIFEST.json`) — the release page itself has no
  formal GitHub release asset, only a user-uploaded file link in the release body text, verified by
  downloading and inspecting it directly rather than assumed from the release page's rendering.

A further source, for `einvoice-commerce` (not a PDF/A concern): the real
[KoSIT "Leitweg-ID Format-Spezifikation Version 2.0.2"](https://xeinkauf.de/app/uploads/2022/11/Leitweg-ID-Formatspezifikation-v2-0-2-1.pdf)
(licence unclear, not vendored — read only), fetched after finding its real URL via `WebSearch` and
curl-verifying it before download (the same discipline that already caught a 404'd URL for the sRGB ICC
profile). `packages/einvoice-commerce/src/leitweg-id.ts`'s check-digit algorithm (ISO/IEC 7064:2003
MOD 97-10) is read directly from this document's §2.4, reproducing its own worked example byte-for-byte, and
separately cross-checked against a real third-party Leitweg-ID validator for a case involving letters — not
just self-consistency between this repo's own generator and validator.

A further naming source, for BT-159 (added together with BT-158 for customs data) and for the first two lines
of each postal address (BT-35/36, BT-50/51, BT-75/76):
[`@e-invoice-eu/core`](https://github.com/gflohr/e-invoice-eu) (**WTFPL**, `package.json`'s own
`license` field), an npm package already a pinned root devDependency (`^3.3.0`) and already used as a
differential oracle elsewhere in this repo (`tools/conformance/oracle-e-invoice-eu.mjs`). BT-159
("Item country of origin") has no business rule anywhere in the vendored ConnectingEurope Schematron —
confirmed absent by grepping both `.sch` files for "BT-159" before reaching for another source, not a first
resort — so `tools/codegen/model/terms.mjs`'s usual "extraction" cross-check (against that Schematron) can't
apply to it at all. Its name is instead read from the `title` of the matching field in this package's own
embedded EN 16931 JSON Schema (`dist/e-invoice-eu.esm.js`, already installed under `node_modules/`, grepped
directly rather than assumed), cross-checked against a second, independent source before trusting it:
[docs.peppol.eu](https://docs.peppol.eu/poacc/billing/3.0/syntax/ubl-invoice/cac-InvoiceLine/cac-Item/cac-OriginCountry/cbc-IdentificationCode/)'s
own per-element page carries the identical description sentence, word for word, not just a similar
paraphrase. The six address-line terms were named the same way: none has a rule in the vendored Schematron,
and each title was checked word for word against its own docs.peppol.eu element page. BT-158 ("Item classification identifier") needed no such fallback — it already has a real
business rule (`BR-65`) that quotes its name directly in the vendored Schematron, the usual "extraction" tier.
The scheme identifier value `"HS"` (`ram:ClassCode/@listID`) is likewise double-checked: present in the
vendored Schematron's own `BR-CL-13` UNTDID 7143 codelist, and independently the exact code
[docs.peppol.eu's own BIS Billing 3.0 documentation](https://docs.peppol.eu/poacc/billing/3.0/bis/) recommends
for this purpose ("It is recommended to use the Item classification identifier (BT-158) for this purpose,
with the code \"HS\" as list identifier.").
