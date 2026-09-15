# eInvoice

MIT-licensed TypeScript core for structured e-invoices ([EN 16931](https://en.wikipedia.org/wiki/CEN/TC_434)), with thin adapters for [Medusa](https://medusajs.com/) v2 and [Vendure](https://www.vendure.io/).

**Status: pre-alpha.** The monorepo is being scaffolded; no package is published or usable yet. See [`docs/README.md`](docs/README.md) for the documentation index and current state.

## Country roadmap

Compliance tooling is only as useful as the list of jurisdictions it actually covers, so this table is
the first thing to read. Two things are tracked per country: whether the **seller-side tax rules** exist
(which VAT category applies, which exemption text, which identifiers — the part no validator can check),
and whether the **document profile the buyer expects** is produced. Dates are targets, not promises; the
changelog is authoritative.

| Country                                   | What is covered                                                                                                                  | Formats / delivery                                                                                       | Status             | Target release         | Why (mandate)                                                                                        |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------ | ---------------------- | ---------------------------------------------------------------------------------------------------- |
| 🇩🇪 Germany                                | Seller tax rules + buyer profiles (B2B and B2G)                                                                                  | XRechnung 3.0 (CII), ZUGFeRD 2.x / Factur-X (`EN 16931`, `XRECHNUNG`), PDF/A-3b; delivery as file/e-mail | In development     | **0.1.0 — 2026-12-01** | B2B e-invoice issuance mandatory from 2027-01-01 (turnover > €800k) and 2028-01-01 (all)             |
| 🇪🇺 Any EU/EEA buyer of a German seller    | Buyer profile only (intra-Community supply, export)                                                                              | EN 16931 hybrid (Factur-X / ZUGFeRD `EN 16931`)                                                          | In development     | 0.1.0 — 2026-12-01     | Accepted EU-wide as a valid EN 16931 invoice                                                         |
| 🇨🇭 🇬🇧 Swiss / UK buyer of a German seller | Buyer profile only (export)                                                                                                      | EN 16931 hybrid                                                                                          | In development     | 0.1.0 — 2026-12-01     | No e-invoice mandate; hybrid PDF widely accepted                                                     |
| 🇳🇴 Norway                                 | Seller tax rules + buyer profile                                                                                                 | EHF 3.0 (= Peppol BIS Billing 3.0, UBL); Peppol delivery via an access-point provider                    | Planned            | 0.2.0 — 2027-02-01     | B2B e-invoicing mandatory from 2027-01-01                                                            |
| 🇩🇰 Denmark                                | Seller tax rules + buyer profile                                                                                                 | Peppol BIS Billing 3.0 (UBL); OIOUBL → NemHandel BIS transition tracked                                  | Planned            | 0.2.0 — 2027-02-01     | Bookkeeping Act: digital bookkeeping systems must exchange e-invoices                                |
| 🇸🇪 Sweden                                 | Seller tax rules + buyer profile                                                                                                 | Peppol BIS Billing 3.0 (UBL)                                                                             | Planned            | 0.2.0 — 2027-02-01     | B2G mandatory since 2019; no B2B mandate yet                                                         |
| 🇩🇰 🇳🇴 🇸🇪 Nordic specifics                 | Corrections (384), partial credit notes, national identifiers (CVR, ELMA, GLN)                                                   | —                                                                                                        | Planned, tentative | 0.3.0 — 2027-04        | —                                                                                                    |
| 🇦🇹 Austria                                | Buyer profile via EN 16931 hybrid or Peppol BIS; seller tax rules                                                                | —                                                                                                        | On request         | —                      | B2G only; no B2B mandate                                                                             |
| 🇧🇪 🇳🇱 Belgium, Netherlands                | Buyer profile via Peppol BIS (after 0.2.0); seller tax rules                                                                     | —                                                                                                        | On request         | —                      | BE: B2B mandatory since 2026-01-01 (Peppol)                                                          |
| 🇫🇮 Finland                                | Peppol BIS / Finvoice                                                                                                            | —                                                                                                        | On request         | —                      | Buyers may demand e-invoices by law                                                                  |
| 🇫🇷 France                                 | Buyer profile: Factur-X is produced already; seller tax rules and the mandatory certified-platform (PDP) submission flow are not | —                                                                                                        | On request         | —                      | Reception mandatory from 2026-09-01; issuance 2026-09-01 (large/mid) and 2027-09-01 (SMEs) via a PDP |
| 🇮🇹 🇵🇱 Italy, Poland                       | —                                                                                                                                | SDI / KSeF are clearance systems with their own XML — no EN 16931 document can serve them                | Not supported      | —                      | —                                                                                                    |
| 🇪🇸 Spain                                  | —                                                                                                                                | Verifactu / Facturae — different model                                                                   | Not supported      | —                      | —                                                                                                    |

Legend: **In development** — code exists and passes the official validators in CI, not yet released ·
**Planned** — scheduled with a target date · **On request** — the core supports it technically; the
country's rules are added when a paying implementation asks for them · **Not supported** — out of scope by
design.

**Not tax advice.** What this project verifies is that the documents it produces pass the official
validators (KoSIT, Mustang, veraPDF) — that runs in CI on every change. The VAT rules it applies are
documented in [`docs/tax-semantics.md`](docs/tax-semantics.md), one scenario per row with its legal source,
and every decision the software makes records the rule it applied. Verify those rules with your own tax
advisor before relying on them; you remain responsible for your invoices. Provided "as is" under the MIT
licence.

A merchant configured with an unsupported seller country will be refused at startup with a clear message
rather than failing on the first order. Want a country moved up? Open an issue — that is exactly the
signal that decides what comes next.

## Packages (planned)

| Package                          | Purpose                                                         |
| -------------------------------- | --------------------------------------------------------------- |
| `@normwerk/einvoice-model`       | Generated EN 16931 types, code lists, JSON Schema               |
| `@normwerk/einvoice-cii`         | UN/CEFACT CII D16B serializer and profiles (XRechnung, ZUGFeRD) |
| `@normwerk/einvoice-ubl`         | OASIS UBL 2.1 serializer (planned for a later release)          |
| `@normwerk/einvoice-pdfa`        | PDF/A-3b assembly with an embedded invoice XML                  |
| `@normwerk/einvoice-commerce`    | Order/refund → EN 16931 tax semantics (platform-agnostic)       |
| `@normwerk/einvoice-conformance` | Dev tooling: runs official validators against fixtures          |
| `@normwerk/einvoice-medusa`      | Medusa v2 adapter                                               |

## Development

Requires Node.js 22 LTS and pnpm 9.

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

Contact: `__________` (placeholder — not yet set up).
