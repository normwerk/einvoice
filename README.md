# eInvoice

MIT-licensed TypeScript core for structured e-invoices ([EN 16931](https://en.wikipedia.org/wiki/CEN/TC_434)), with a thin adapter for [Medusa](https://medusajs.com/) v2: a store run by a German seller issues an XRechnung or ZUGFeRD / Factur-X invoice when an order is fulfilled, and a credit note when it is refunded or cancelled. An adapter for [Vendure](https://www.vendure.io/) is planned.

**Status: pre-release.** Everything below is implemented and tested, but not yet published to npm. See [`docs/README.md`](docs/README.md) for the documentation index; the same documentation is published at [normwerk.dev/einvoice/docs](https://normwerk.dev/einvoice/docs/).

## Contents

- [What it covers](#what-it-covers) — [who it serves](#who-it-serves), [scenarios](#scenarios),
  [what it refuses](#what-it-refuses)
- [How correctness is verified](#how-correctness-is-verified)
- [Packages](#packages)
- [Getting started](#getting-started)
- [Country roadmap](#country-roadmap)
- [Other planned work](#other-planned-work)
- [Development](#development)
- [License](#license)
- [Commercial support](#commercial-support)

## What it covers

### Who it serves

The seller is in **Germany**. What each buyer receives:

| Buyer                                                           | Document                                                                    |
| --------------------------------------------------------------- | --------------------------------------------------------------------------- |
| 🇩🇪 Business or consumer in Germany                              | ZUGFeRD / Factur-X, `EN 16931` profile — or XRechnung 3.0, if you prefer it |
| 🇩🇪 Public-sector buyer (B2G)                                    | XRechnung 3.0, carrying the buyer's Leitweg-ID (check digits verified)      |
| 🇪🇺 Any EU/EEA buyer of a German seller, except Italy and Poland | ZUGFeRD / Factur-X, `EN 16931` profile                                      |
| 🇨🇭 🇬🇧 Swiss / UK buyer of a German seller                       | ZUGFeRD / Factur-X, `EN 16931` profile                                      |

Every document is UN/CEFACT CII XML. When a PDF is configured — the bundled renderer or your own — the XML
is embedded into a PDF/A-3b hybrid. Documents are stored privately with
the order and can be downloaded from the order page in Medusa Admin, and by the customer who placed the
order through the Store API.

### Scenarios

| Scenario                                                                                      | VAT category (BT-118) |
| --------------------------------------------------------------------------------------------- | --------------------- |
| Domestic sale at 19% or 7%, or at both rates on one invoice                                   | S                     |
| Public-sector buyer with a Leitweg-ID                                                         | S                     |
| Private buyer, including a guest checkout                                                     | S                     |
| Goods to a business in another EU member state, its VAT-ID verified                           | K                     |
| Goods exported outside the EU — decided by where the goods go, not by who buys                | G                     |
| Services to a business in another EU member state, declared per order                         | AE                    |
| Domestic reverse charge (§13b UStG), declared per order                                       | AE                    |
| Exempt or zero-rated domestic supply, declared per order                                      | E, Z                  |
| Distance sale of goods to an EU consumer by an OSS-registered seller, at the destination rate | S                     |
| Prices entered including VAT — the invoice totals exactly what the buyer was charged          | as the sale           |
| Shipping charges and promotion discounts, taxed at the rate of the goods they belong to       | as the sale           |
| Refund or return → credit note referencing the invoice                                        | as invoiced           |
| Partial refund → credit note for the refunded amount                                          | as invoiced           |
| Cancellation after invoicing → credit note for what is outstanding                            | as invoiced           |

Each scenario is a row of [`docs/tax-semantics.md`](docs/tax-semantics.md), with its legal source, and runs
as synthetic Medusa orders through the real adapter and the official validator (see
[below](#how-correctness-is-verified)). How each Medusa field maps to an EN 16931 business term:
[`docs/mapping-reference-medusa.md`](docs/mapping-reference-medusa.md).

### What it refuses

Where a correct invoice cannot be derived, the plugin refuses and names the reason instead of guessing:

- a seller outside Germany, or a Medusa release it has not been shown to work on — the plugin does not start;
- a buyer in Italy or Poland (their national clearance platforms accept no EN 16931 document), or outside
  the EU/EEA, Switzerland and the UK;
- goods to a business in another EU member state whose VAT-ID has not been verified;
- business services to a buyer outside the EU, for which there is no settled basis yet;
- a domestic line that Medusa charged at a rate other than 19% or 7%.

The full list, each with its reason, is in [`docs/tax-semantics.md`](docs/tax-semantics.md). A refused
document never holds up the order: it shows in the order's "E-Invoices" block in Medusa Admin with its
reason and a stable code, explained in the [error reference](https://normwerk.dev/einvoice/docs/errors), and
can be issued again once the cause is fixed. Corrected
invoices (document type 384) are not produced; corrections are credit notes.

## How correctness is verified

An e-invoice is either accepted or rejected, so the bar is binary: every fixture passes every check that
applies to it — not a pass rate. The validators below are the official tools themselves, not a
reimplementation of their rules.

| Check                           | What it proves                                                                                                                                                                                                                              | When it runs                                  |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| Unit tests                      | Every VAT decision in [`docs/tax-semantics.md`](docs/tax-semantics.md) has its own code path and tests; amounts are exact decimals, rounded to the cent as the EN 16931 rules require. Coverage floors are enforced                         | Every pull request and every push to `main`   |
| Schema and business rules       | XSD and Schematron, including the German XRechnung rules, checked by the official **KoSIT Validator** — for hand-built fixtures, for invoices built by the core, and for synthetic Medusa orders run through the real adapter               | Every pull request and every push to `main`   |
| PDF/A-3b and ZUGFeRD / Factur-X | Every fixture as a hybrid PDF, in both profiles, checked by **veraPDF** and **Mustang**                                                                                                                                                     | Every pull request and every push to `main`   |
| Differential                    | Our XML compared with the output of two independent open-source generators. Every difference is classified — our bug, theirs, or a permissible variation — with the rule behind the verdict; a new, unclassified difference fails the build | Every pull request and every push to `main`   |
| Round-trip                      | Mustang, a separate implementation, reads our XML back; its totals, VAT breakdown and line amounts must match what was meant to be written                                                                                                  | Every pull request and every push to `main`   |
| End-to-end                      | A real Medusa store installs the packages from a registry, as a shop would, and turns orders, refunds and cancellations into documents checked by KoSIT and veraPDF                                                                         | Nightly in CI, and `pnpm e2e` on your machine |

Why you can rely on these results:

- **Official tools, pinned.** KoSIT, Mustang and veraPDF run in Docker at versions pinned by digest
  ([`docker/images.lock`](docker/images.lock)). Upgrading one is a change of its own, with the fixture
  results reviewed.
- **Built from the official artifacts.** The model's types and code lists are generated from the published
  EN 16931 artifacts, and the serializer's element order is checked against the official XSD and
  Schematron; each artifact is recorded with its source, version and hash in
  [`docs/sources.md`](docs/sources.md). No third-party e-invoicing library runs in your shop, and the build
  rejects copyleft runtime dependencies.
- **Deterministic output.** The same input always gives byte-identical XML; the build regenerates the
  generated code and fails on any difference.
- **Evidence in the repository.** The differential reports are committed —
  [`docs/l4-oracle-eu-report.md`](docs/l4-oracle-eu-report.md) and
  [`docs/l4-oracle-facturx-report.md`](docs/l4-oracle-facturx-report.md) — and the build fails when they go
  stale. The Medusa releases the end-to-end suite has passed on, and the ones it has not, are in the
  plugin's [compatibility table](packages/einvoice-medusa/README.md#compatibility).
- **Check it yourself.** `pnpm e2e` runs the end-to-end suite on your machine in about four minutes, with
  Docker — see [`docs/e2e.md`](docs/e2e.md). Every suite is listed in
  [`docs/test-cases.md`](docs/test-cases.md).

**What this does not prove.** Validators check that a document is well-formed and that its amounts add up.
They cannot tell whether the VAT category is the right one for the sale. That judgement is documented in
[`docs/tax-semantics.md`](docs/tax-semantics.md), one scenario per row with its legal source, and every
category decision the core makes names the rule it applied.

**Not tax advice.** Verify those rules with your own tax advisor before relying on them; you remain
responsible for your invoices. Provided "as is" under the MIT licence.

## Packages

| Package                          | Purpose                                                            |
| -------------------------------- | ------------------------------------------------------------------ |
| `@normwerk/einvoice-model`       | Generated EN 16931 types, code lists, JSON Schema                  |
| `@normwerk/einvoice-cii`         | UN/CEFACT CII D16B serializer and profiles (XRechnung, ZUGFeRD)    |
| `@normwerk/einvoice-pdfa`        | PDF/A-3b assembly with an embedded invoice XML                     |
| `@normwerk/einvoice-commerce`    | Order/refund → EN 16931 tax semantics (platform-agnostic)          |
| `@normwerk/einvoice-medusa`      | Medusa v2 adapter                                                  |
| `@normwerk/einvoice-conformance` | Dev tooling: runs official validators against fixtures             |
| `@normwerk/einvoice-ubl`         | OASIS UBL 2.1 serializer — a scaffold, planned for a later release |

## Getting started

Once 0.1.0 is published to npm, a Medusa v2 store — Medusa 2.12–2.15, or 2.18 or a later 2.x release, on
Node `^20.19.0` or `>=22.12.0` — installs it with:

```bash
npm install @normwerk/einvoice-medusa @normwerk/einvoice-model @normwerk/einvoice-commerce @normwerk/einvoice-cii
```

The [Medusa quickstart](docs/quickstart-medusa.md) takes a fresh `create-medusa-app` project to a
KoSIT-validated invoice on its first fulfilled order in about 30 minutes: configuration, migrations, and the
optional PDF modes. Until the release, [`pnpm e2e`](docs/e2e.md) shows the same flow on your machine.

## Country roadmap

What works today is listed [above](#what-it-covers); this table tracks every country, including what comes
next. Two things are tracked per country: whether the **seller-side tax rules** exist (which VAT category
applies, which exemption text, which identifiers — the part no validator can check), and whether the
**document profile the buyer expects** is produced. Dates are targets, not promises.

| Country                                   | What is covered                                                                                                                  | Formats / delivery                                                                                  | Status             | Target release         | Why (mandate)                                                                                        |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------ | ---------------------- | ---------------------------------------------------------------------------------------------------- |
| 🇩🇪 Germany                                | Seller tax rules + buyer profiles (B2B and B2G)                                                                                  | XRechnung 3.0 (CII), ZUGFeRD 2.x / Factur-X (`EN 16931`, `XRECHNUNG`), PDF/A-3b; delivery as a file | In development     | **0.1.0 — 2026-11-01** | B2B e-invoice issuance mandatory from 2027-01-01 (turnover > €800k) and 2028-01-01 (all)             |
| 🇪🇺 Any EU/EEA buyer of a German seller    | Buyer profile only (intra-Community supply, export)                                                                              | EN 16931 hybrid (Factur-X / ZUGFeRD `EN 16931`)                                                     | In development     | 0.1.0 — 2026-11-01     | Accepted EU-wide as a valid EN 16931 invoice                                                         |
| 🇨🇭 🇬🇧 Swiss / UK buyer of a German seller | Buyer profile only (export)                                                                                                      | EN 16931 hybrid                                                                                     | In development     | 0.1.0 — 2026-11-01     | No e-invoice mandate; hybrid PDF widely accepted                                                     |
| 🇳🇴 Norway                                 | Seller tax rules + buyer profile                                                                                                 | EHF 3.0 (= Peppol BIS Billing 3.0, UBL); Peppol delivery via an access-point provider               | Planned            | 0.2.0 — 2026-12-01     | B2B e-invoicing mandatory from 2027-01-01                                                            |
| 🇩🇰 Denmark                                | Seller tax rules + buyer profile                                                                                                 | Peppol BIS Billing 3.0 (UBL); OIOUBL → NemHandel BIS transition tracked                             | Planned            | 0.2.0 — 2026-12-01     | Bookkeeping Act: digital bookkeeping systems must exchange e-invoices                                |
| 🇸🇪 Sweden                                 | Seller tax rules + buyer profile                                                                                                 | Peppol BIS Billing 3.0 (UBL)                                                                        | Planned            | 0.2.0 — 2026-12-01     | B2G mandatory since 2019; no B2B mandate yet                                                         |
| 🇩🇰 🇳🇴 🇸🇪 Nordic specifics                 | Corrections (384), partial credit notes, national identifiers (CVR, ELMA, GLN)                                                   | —                                                                                                   | Planned, tentative | 0.3.0 — 2027-04        | —                                                                                                    |
| 🇦🇹 Austria                                | Buyer profile via EN 16931 hybrid or Peppol BIS; seller tax rules                                                                | —                                                                                                   | On request         | —                      | B2G only; no B2B mandate                                                                             |
| 🇧🇪 🇳🇱 Belgium, Netherlands                | Buyer profile via Peppol BIS (after 0.2.0); seller tax rules                                                                     | —                                                                                                   | On request         | —                      | BE: B2B mandatory since 2026-01-01 (Peppol)                                                          |
| 🇫🇮 Finland                                | Peppol BIS / Finvoice                                                                                                            | —                                                                                                   | On request         | —                      | Buyers may demand e-invoices by law                                                                  |
| 🇫🇷 France                                 | Buyer profile: Factur-X is produced already; seller tax rules and the mandatory certified-platform (PDP) submission flow are not | —                                                                                                   | On request         | —                      | Reception mandatory from 2026-09-01; issuance 2026-09-01 (large/mid) and 2027-09-01 (SMEs) via a PDP |
| 🇮🇹 🇵🇱 Italy, Poland                       | —                                                                                                                                | SDI / KSeF are clearance systems with their own XML — no EN 16931 document can serve them           | Not supported      | —                      | —                                                                                                    |
| 🇪🇸 Spain                                  | —                                                                                                                                | Verifactu / Facturae — different model                                                              | Not supported      | —                      | —                                                                                                    |

Legend: **In development** — code exists and its fixtures pass the official validators, not yet released ·
**Planned** — scheduled with a target date · **On request** — the core supports it technically; the
country's rules are added when a paying implementation asks for them · **Not supported** — out of scope by
design.

Want a country moved up? Open an issue — that is exactly the signal that decides what comes next.

## Other planned work

- **Vendure adapter** — the same core behind a thin [Vendure](https://www.vendure.io/) plugin.
- **UBL 2.1 serializer** (`@normwerk/einvoice-ubl`, a scaffold today) — the syntax of Peppol BIS Billing
  3.0, which the Nordic rows above need.

## Development

Requires Node.js 22 or newer (`engines.node: >=22`) and pnpm 9.

```bash
pnpm install
pnpm build
pnpm typecheck
pnpm test
```

Running the conformance validators additionally requires Docker:

```bash
docker compose -f docker/compose.conformance.yml build
pnpm conformance validate <file.xml|file.pdf>
```

See [`docs/README.md`](docs/README.md) for more.

## License

MIT — see [`LICENSE`](LICENSE).

## Commercial support

Implementation, adaptation to your stack, and support retainers: **hello@normwerk.dev**. We answer within
three business days. Maintained by Important Dreams.
