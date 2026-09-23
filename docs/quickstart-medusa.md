# Quickstart: `einvoice-medusa`

Back to [`docs/README.md`](README.md). Goal: a fresh Medusa v2 project fulfilling its first order into a
real, KoSIT-passing XRechnung, in about 30 minutes — verified by actually timing this exact sequence end to
end (see "How this was verified" at the bottom), not written from memory of how the plugin is supposed to
work.

## Prerequisites

- Node `^20.19.0` or `>=22.12.0` (`einvoice-medusa`'s own `engines` field).
- A Medusa v2 project with a real Postgres database. If you don't have one yet:
  ```bash
  npx create-medusa-app@latest my-store --db-url "postgres://user:pass@localhost:5432/my_store_db"
  ```
  `create-medusa-app` has scaffolded a small turborepo monorepo since at least v2.19.0 — your actual Medusa
  app lives at `apps/backend/`, not the project root. Every command below runs from there
  (`cd my-store/apps/backend`).

## 1. Install

```bash
npm install @normwerk/einvoice-medusa @normwerk/einvoice-model @normwerk/einvoice-commerce @normwerk/einvoice-cii
```

Only add `@normwerk/einvoice-pdfa` if you plan to use `standalone.basePdf` with its bundled
`renderInvoicePdf` (step 5) rather than your own PDF renderer or a supported PDF plugin:

```bash
npm install @normwerk/einvoice-pdfa
```

## 2. Configure the plugin

Edit `medusa-config.ts`:

```ts
export default defineConfig({
  // ...your existing projectConfig...
  plugins: [
    {
      resolve: "@normwerk/einvoice-medusa",
      options: {
        seller: {
          name: "Your Company GmbH",
          countryCode: "DE",
          addressLine1: "Musterstraße 1",
          city: "Berlin",
          postCode: "10115",
          vatIdentifier: "DE123456789",
          electronicAddress: "invoicing@yourcompany.example",
          electronicAddressScheme: "EM",
          contact: {
            name: "Accounting",
            telephone: "+49 30 1234567",
            email: "invoicing@yourcompany.example",
          },
        },
        payment: {
          means: "58", // SEPA credit transfer
          iban: "DE89370400440532013000",
        },
      },
    },
  ],
});
```

`seller.addressLine1`, `seller.contact` and `payment` all look like they could be optional from their
TypeScript types alone — they aren't. §14 Abs. 4 Satz 1 Nr. 1 UStG requires the seller's full address on
every invoice, street included (`addressLine2` is optional). Every document this plugin builds targets the
full XRechnung 3.0 CIUS regardless of who the buyer is, and that CIUS makes seller contact (BR-DE-2) and
payment instructions (BR-DE-1) mandatory. Leave any of them out and the plugin refuses to start at all
(`InvalidEinvoiceModuleOptionsError`, thrown from the module's own constructor) — a loud failure at boot,
not a document that silently fails validation later.

## 3. Run migrations

```bash
npx medusa db:migrate
```

This creates `einvoice_document` and `einvoice_counter` (this plugin's own two tables — no schema
changes to any core Medusa table).

## 4. Try it

Start the dev server (`npx medusa develop`), then fulfill any real order (admin dashboard, or
`POST /admin/orders/:id/fulfillments`). Within about a second, open that order's page: a new "E-Invoices"
side-panel section lists the invoice, with XML (and PDF, once you've done step 5 or 6) download links.
Refund a captured payment and a credit note appears the same way, for the refunded amount; cancel an
invoiced order and a credit note reverses what is still outstanding.

The invoice is issued when an order is fulfilled — an order of services too. A product with no shipping
profile whose variants manage no inventory needs no shipping: its cart completes without a shipping method,
and Medusa accepts a fulfillment for it without a shipping option. Create that fulfillment, and the invoice
appears the same way.

## 5. Optional: attach a PDF without your own renderer

```ts
standalone: {
  basePdf: async (invoice) => {
    const { renderInvoicePdf } = await import("@normwerk/einvoice-pdfa");
    return renderInvoicePdf(invoice);
  },
},
```

`invoice` here is the fully built EN 16931 `Invoice` — the exact same data the XML carries, so the PDF and
XML can never disagree on numbers. `renderInvoicePdf` is a real, font-embedded, PDF/A-eligible layout that
ships with `@normwerk/einvoice-pdfa`; use your own renderer instead if you have one (same option, any
function returning `Uint8Array | undefined`).

## 6. Optional: integrate with `@webbers/invoices-medusa`

If you already run `@webbers/invoices-medusa` for PDF invoices, don't configure `standalone` at all — set:

```ts
integration: { kind: "webbers" },
```

This plugin then reuses _their_ invoice's own number instead of allocating its own, and embeds this
plugin's XML into their PDF. See
[`docs/domain-glossary.md`](domain-glossary.md)'s own T-072 section for real, tested caveats with their
package (some genuine bugs in their `1.0.6` release, worked around or documented there).

## Buyer VAT-ID and B2G references

Neither has a first-class Medusa field — set them on the order's customer, under `metadata`:

- `customer.metadata.vat_id` — the buyer's VAT-ID (BT-48).
- `customer.metadata.buyer_reference` — a real Leitweg-ID for a B2G buyer (BT-10). Setting this also makes
  the plugin choose the XRechnung profile automatically for that order (a Leitweg-ID buyer always gets
  XRECHNUNG, regardless of `defaultProfile`).

## EU business buyers: VAT-ID verification

An order from a business in another EU member state with a VAT-ID is an intra-Community supply (category K,
0%) — but only once that VAT-ID has been confirmed. Without the `vatIdVerifier` option such an order is
refused (`TaxRuleError`) rather than invoiced on an unverified number. The plugin does not ship a VIES client;
you provide one that implements `VatIdVerifier` from `@normwerk/einvoice-commerce`:

```ts
vatIdVerifier: {
  async verify(vatId: string, now: Date) {
    // Call the EU's VIES service here (or your own cached copy of its answers).
    return {
      vatId,
      status: "valid", // "valid" | "invalid" | "unavailable"
      checkedAt: now.toISOString().slice(0, 10),
      consultationNumber: "…", // VIES's own reference for the check, keep it as evidence
    };
  },
},
```

If VIES is unavailable, the order can still be invoiced as K when you confirmed the number another way:
set `order.metadata.regime_override` to `{ "kind": "intra-eu-confirmed", "evidenceNote": "…" }`. The same
field declares the other regimes the plugin never infers on its own (reverse charge, exempt, zero-rated —
see [`docs/tax-semantics.md`](tax-semantics.md)). For OSS distance sales, set the plugin option
`ossRegistered: true` and, per order, `order.metadata.oss_rate_override` to the destination country's rate.

## Shipping, promotions, and what Medusa charged

Shipping methods appear on the invoice as one document-level charge, and a promotion on an item as a
discount on that item's line — both as Medusa computed them. The plugin also compares the invoice total with
what Medusa charged (`order.total`) and logs a warning when they differ by more than rounding. The usual
cause is Medusa's tax settings: if your tax regions charge no VAT, or charge VAT on an order the invoice
treats as tax-free (an intra-EU supply, an export), the invoice is correct and the payment is not.

With tax-inclusive prices the two can also differ by a cent, without a warning. The invoice is built from
net amounts: each line's net amount is rounded to the cent and VAT is computed on their sum, as EN 16931
requires, while Medusa charges the gross prices as shown. A T-shirt at EUR 10.00 and shipping at EUR 10.00,
both including 19% VAT, are charged as 20.00 and invoiced as 19.99 (8.40 + 8.40 net, 3.19 VAT).

## Downloading a document yourself

- **Admin**: the order page's own "E-Invoices" widget, or `GET /admin/orders/:id/einvoice` for the raw list.
- **Storefront**: `GET /store/orders/:id/einvoice` — requires a logged-in customer who owns the order (a
  guest order has no way to authenticate as its own "customer" today, a known v0.1 limitation).

## Where to go next

- [`docs/mapping-reference-medusa.md`](mapping-reference-medusa.md) — exactly which Medusa field feeds
  which BT/BG number, and which ones this plugin can't source from Medusa at all yet.
- [`docs/features/einvoice-medusa.md`](features/einvoice-medusa.md) — the storage/widget/API design, and
  what was and wasn't verified.
- [`docs/domain-glossary.md`](domain-glossary.md)'s Medusa v2 section — every real gotcha found building
  this (exact event names/payloads, `query.graph` quirks, migration pitfalls).

## How this was verified

This exact sequence was run against a real, freshly scaffolded `create-medusa-app@2.19.0` project (Docker
Postgres), start to finish, and timed: **environment setup (steps 1–3) took under 10 minutes**, and a
fulfilled order produced a real, KoSIT-validated invoice within seconds of step 4. `@normwerk/einvoice-*`
aren't published to npm yet (that's T-076's own job) — this run substituted `yalc` for step 1's `npm
install`, `medusa-config.ts` was edited exactly as shown, and every other step ran unmodified. Once T-076
publishes these packages for real, this quickstart should be re-run once against the actual npm registry
before being called final — a `yalc`-substituted install is a faithful stand-in for module resolution, but
not for npm's own package resolution/version constraints.
