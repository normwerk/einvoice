# Quickstart: `einvoice-medusa`

Back to [`docs/README.md`](README.md). Goal: a fresh Medusa v2 project fulfilling its first order into a
real, KoSIT-passing XRechnung, in about 30 minutes — verified by actually timing this exact sequence end to
end (see "How this was verified" at the bottom), not written from memory of how the plugin is supposed to
work.

## Prerequisites

- Node `^20.19.0` or `>=22.12.0` (`einvoice-medusa`'s own `engines` field).
- Medusa 2.12–2.15, or 2.18 or a later 2.x release — the releases the [end-to-end suite](e2e.md) passes
  on. On any other release the plugin refuses to start (`UnsupportedMedusaVersionError`); see the
  [compatibility table](../packages/einvoice-medusa/README.md#compatibility) for why 2.16 and 2.17 are out.
- A shop that charges German VAT. A Kleinunternehmer (§19 UStG) need not issue e-invoices (§34a Satz 4
  UStDV) and is not supported: an order on which no VAT was charged is refused (`NO_VAT_CHARGED`).
- Exchanges and warranty replacements are yours to document: the plugin refuses their shipments visibly
  ([what it does instead](features/einvoice-medusa.md#exchanges-warranty-replacements-and-prices-edited-after-the-invoice)).
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
payment instructions (BR-DE-1) mandatory. `seller.countryCode` has to be `"DE"`: the VAT rules the plugin
applies are German law. Leave any of them out, or give another seller country, and the plugin refuses to
start at all (`InvalidEinvoiceModuleOptionsError`, thrown from the module's own constructor, with the code
`INVALID_PLUGIN_OPTIONS` or `UNSUPPORTED_SELLER_COUNTRY`) — a loud failure at boot, not a document that
silently fails validation later. The store's settings page in Medusa Admin shows an "E-Invoicing" block
with what this release supports: the seller country, the documents, the buyers it serves and the ones it
refuses.

## 3. Run migrations

```bash
npx medusa db:migrate
```

This creates `einvoice_document` and `einvoice_counter` (this plugin's own two tables — no schema
changes to any core Medusa table).

## 4. Try it

Start the dev server (`npx medusa develop`), then fulfill any real order (admin dashboard, or
`POST /admin/orders/:id/fulfillments`). Within about a second, open that order's page: a new "E-Invoices"
side-panel section lists the invoice, with XML (and PDF, once you've done step 5) download links.
Refund a captured payment and a credit note appears the same way, for the refunded amount; cancel a
fulfillment, or the whole order, and a credit note reverses what is still outstanding on its invoice.

Each fulfillment gets an invoice of its own, for the lines and units it shipped and dated the day it
shipped: ship an order at once and it has one invoice, ship it in parts and it has one per part. The
order's shipping is on the first of them. If the order was paid in full before it shipped — the payment
captured in Medusa — each invoice states its total as paid, with nothing due.

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
function returning `Uint8Array | undefined`). Your PDF has to embed its fonts and must not be encrypted —
PDF/A requires both, and nothing repairs it afterwards. If it does not, the document is issued as XML alone,
and the admin shows "XML only" with the reason (`PDF_FONT_NOT_EMBEDDED` names the font); see
[`pdfa.md`](pdfa.md#a-pdf-rendered-elsewhere-checked-not-repaired).

## 6. Another plugin that issues invoices

This plugin numbers and issues the invoices itself. If another plugin issues invoices too — a PDF invoice
plugin such as `@webbers/invoices-medusa` — the buyer gets two invoices for one supply, and the VAT shown is
owed on each (§14c Abs. 1 UStG). Turn invoice creation off in the other plugin, or remove it. The plugin
warns at startup when it finds `@webbers/invoices-medusa` registered.

There is no mode that embeds this plugin's XML into another plugin's PDF: such a PDF shows Medusa's totals,
which differ from the e-invoice wherever the plugin corrects the VAT (a reverse-charge supply, shipping
split across rates). An `integration` option is refused at startup. For a PDF, use `standalone.basePdf`
(step 5).

## Buyer VAT-ID and B2G references

Neither has a first-class Medusa field — set them on the order's customer, under `metadata`:

- `customer.metadata.vat_id` — the buyer's VAT-ID (BT-48).
- `customer.metadata.leitweg_id` — the Leitweg-ID of a German public-sector buyer (B2G). It goes into the
  buyer reference (BT-10) after its check digits are verified, and makes the plugin choose the XRechnung
  profile for that customer's orders, regardless of `defaultProfile`. An invalid Leitweg-ID is refused.
- `customer.metadata.buyer_reference` — the buyer's own reference for their invoices (BT-10), free text.
  Without either, BT-10 carries the order number. A value that merely looks like a Leitweg-ID here is never
  treated as one.

## EU business buyers: VAT-ID verification

An order from a business in another EU member state with a VAT-ID is an intra-Community supply (category K,
0%) — but only once that VAT-ID has been confirmed. Without the `vatIdVerifier` option such an order is
refused (`VAT_ID_UNVERIFIED`) rather than invoiced on an unverified number. The plugin does not ship a VIES client;
you provide one that implements `VatIdVerifier` from `@normwerk/einvoice-commerce`:

```ts
vatIdVerifier: {
  async verify(vatId: string, now: Date) {
    // Call the EU's VIES service here (or your own cached copy of its answers).
    return {
      vatId,
      status: "valid", // "valid" | "invalid" | "unavailable"
      checkedAt: now.toISOString().slice(0, 10),
      consultationNumber: "…", // VIES's own reference for the check
    };
  },
},
```

The exemption rests on the buyer's VAT-ID being valid on the day of supply, and you must be able to show
that. The plugin keeps the answer your verifier returned — VAT-ID, status, date, consultation number — with
every document of category K, and shows it under the document in the order's "E-Invoices" block; what else
it stores is listed in [the feature page](features/einvoice-medusa.md#what-the-plugin-stores).

If VIES is unavailable, the order can still be invoiced as K when you confirmed the number another way:
set `order.metadata.regime_override` to `{ "kind": "intra-eu-confirmed", "evidenceNote": "…" }`. The same
field declares the other regimes the plugin never infers on its own (reverse charge, exempt, zero-rated —
see [`docs/tax-semantics.md`](tax-semantics.md)). For OSS distance sales, set the plugin option
`ossRegistered: true` and, per order, `order.metadata.oss_rate_override` to the destination country's rate.
OSS covers goods only, at that one rate: an OSS order for a service, or with a line Medusa taxed at a
reduced destination rate, is refused.

## Shipping, promotions, and what Medusa charged

Shipping methods appear on the invoice as one document-level charge, and a promotion on an item as a
discount on that item's line — both as Medusa computed them. In an order with lines at 19% and 7%,
shipping is split across the two rates in proportion to the lines' net amounts, one charge per rate
("Versand / Shipping (anteilig 7 %)"). Medusa itself taxes shipping at one rate, so such an invoice states
less VAT than Medusa charged and is issued with a notice naming shipping as the cause. Before issuing an invoice, the plugin compares
its VAT and total with what Medusa charged (see [When the invoice and Medusa disagree](#when-the-invoice-and-medusa-disagree)).

On a domestic order, each line is invoiced at the rate Medusa charged on it, which has to be 19% or 7%. A
line Medusa charged at any other rate — 0% included, which is what a tax region without a default rate
charges — is refused with an error naming the line, instead of being invoiced at a rate the buyer did not
pay. Set up the German tax region with its rates before the first order.

Tax-inclusive prices (Medusa's price preferences with "Tax inclusive" on) are invoiced as the gross
amounts Medusa charged: the VAT of each rate is taken out of that rate's gross total, and the net amounts on
the invoice's lines add up to the rest. A T-shirt at EUR 10.00 and shipping at EUR 10.00, both including
19% VAT, are invoiced as 20.00 (16.81 net, 3.19 VAT) — exactly what was charged.

## When the invoice and Medusa disagree

Medusa charges VAT at checkout by the region alone; the invoice decides it from the buyer's VAT-ID and where
the goods go. So the VAT on the invoice can differ from the VAT Medusa charged — typically an intra-EU
supply to a business (category K, 0%) in a region whose tax settings charge VAT. The plugin compares the
invoice's VAT with `order.tax_total` and its total with `order.total` (plus Medusa's credit lines: store
credit, gift cards and refunds are payments), and the outcome shows in the order page's "E-Invoices" block:

- **Issued, "Refund due"** (`VAT_OVERCHARGED`) — prices without VAT; the invoice states less VAT than
  Medusa charged, and the buyer paid the difference on top. The invoice is correct; refund the amount the
  notice names with an ordinary refund in Medusa. That refund issues no credit note — a refund beyond it
  credits only the part beyond it.
- **Issued, "VAT differs from Medusa"** (`VAT_DIFFERS_FROM_MEDUSA`) — prices including VAT; the buyer paid
  exactly the invoice total, so there is nothing to refund, but Medusa counts a different VAT than the
  invoice. Take VAT for your returns from the invoices, not from Medusa's order totals. When Medusa counts
  more VAT (an intra-EU business buyer at 0%), a business buyer pays your gross price without the VAT
  deducted; if you sell to businesses in other EU countries, a separate price list with net prices for
  them avoids it. When Medusa counts less, the invoice's VAT is still owed out of what the buyer paid —
  check the tax rate of the shipping option and the region in Medusa, whose reports understate the VAT.
- **"Invoice not issued"** — the invoice would state more VAT than Medusa charged, and so a higher total
  than the buyer paid (`INVOICE_VAT_ABOVE_CHARGED`: VAT on an invoice is owed, §14c UStG, whatever was charged), or the totals
  differ for another reason (`INVOICE_TOTAL_MISMATCH`), or Medusa returned no totals
  (`CHARGED_TOTALS_MISSING`). No document number is taken. The block shows the reason with the amounts.
  Correct the cause — usually a tax region, product or shipping option charging the wrong rate — and then
  the order: Medusa keeps an order's tax lines as they were at checkout, and recomputes them only with its
  `updateOrderTaxLinesWorkflow` (for example from a script run with `npx medusa exec`). Recompute only
  the lines that were wrong (`shipping_method_ids`, `item_ids`): on Medusa 2.12.6 recomputing the whole
  order added a second tax line to every item instead of replacing it. Then press
  **Retry** in the block (or `POST /admin/orders/:id/einvoice/refusals/:refusalId/retry`); a retry that
  still disagrees says why again. If the order cannot be corrected, issue that invoice outside the plugin.

An intra-EU supply must be invoiced by the 15th of the following month (§14a UStG) — check the block for
orders that were not issued.

## Documents not issued for another reason

Any document the plugin refuses before it takes a number shows in the same block as "Invoice not issued" or
"Credit note not issued", with the reason and a code, and can be retried — nothing is lost in a log. The
code stays the same across releases and links to its explanation on the
[error reference](https://normwerk.dev/einvoice/docs/errors). For example:

- `VAT_ID_UNVERIFIED` — VIES did not confirm the buyer's VAT-ID when the order shipped: retry once VIES
  answers again, or, if you confirmed the number another way, set `order.metadata.regime_override` to
  `{ "kind": "intra-eu-confirmed", "evidenceNote": "…" }` and retry.
- `MISSING_ORIGINAL_INVOICE` — a refund for an order whose invoice was not issued (or was issued before
  the plugin was installed). Issue the invoice first, then retry the credit note.
- `UNSUPPORTED_BUYER_COUNTRY_CLEARANCE` — a buyer in Italy or Poland, whose clearance platforms take their
  own national XML; this release does not serve them. The block links to a support request for the
  country, filled in beforehand — nothing is sent unless you open and submit it.
- `INTERNAL_ERROR` — anything unexpected; the reason says what happened.

The order itself is never held up: a refusal only means the document is missing.

Retrying a credit note redelivers the refund or cancellation it belongs to. Cancelling an order drops its
refused invoices: a cancelled order is not invoiced.

## Refunds, returns and cancellations

A refund is credited for its own amount, a cancellation for whatever is still uncredited. In an order with
lines at different rates, the credit note states each rate: a refund first pays for goods the buyer sent
back and you received in Medusa (a received return), at their lines' rates, in the order you received
them; the rest is split across the rates in proportion to what is still uncredited at each. Receive the
return in Medusa before you refund it, so the refund is credited at the returned goods' rate — and, for an
order shipped in parts, on the invoice that holds those goods. A refund with no goods received back, while
the order has more than one invoice open or a part not shipped yet, is not credited by the plugin: it shows
as "Credit note not issued" (`REFUND_NEEDS_MANUAL_CREDIT`). A refund for goods never shipped needs no credit
note; for goodwill on an invoice, issue the credit note yourself.

## Downloading a document yourself

- **Admin**: the order page's own "E-Invoices" widget, or `GET /admin/orders/:id/einvoice` for the raw list
  (with each document's notice, and the documents not issued).
- **Storefront**: `GET /store/orders/:id/einvoice` — requires a logged-in customer who owns the order (a
  guest order has no way to authenticate as its own "customer" today, a known v0.1 limitation).

## Sending the invoice to the buyer

The plugin issues and stores documents; it sends nothing. It announces each document on Medusa's event bus
instead — `einvoice.document_issued`, and `einvoice.issuance_blocked` for one it did not issue — so your own
subscriber can mail it, pass it to accounting, or alert someone
([the events and what they carry](features/einvoice-medusa.md#events-and-the-order-link--for-a-shops-own-code)).
An example with Medusa's Notification Module — not part of the plugin; the template, and how your provider
wants an attachment's content, are yours:

```ts
// src/subscribers/send-einvoice.ts
import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import type { DocumentIssuedEvent, EinvoiceDocumentDTO } from "@normwerk/einvoice-medusa/events";

export default async function sendEinvoice({
  event: { data },
  container,
}: SubscriberArgs<DocumentIssuedEvent>): Promise<void> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const { data: orders } = await query.graph({
    entity: "order",
    filters: { id: data.order_id },
    fields: ["email", "einvoice_documents.*"],
  });
  const order = orders[0] as { email: string; einvoice_documents: EinvoiceDocumentDTO[] };
  const document = order.einvoice_documents.find((d) => d.id === data.id);
  if (document === undefined) return;

  const fileId = document.pdf_file_id ?? document.xml_file_id;
  const file = await container.resolve(Modules.FILE).retrieveFile(fileId);
  const bytes = Buffer.from(await (await fetch(file.url)).arrayBuffer());

  await container.resolve(Modules.NOTIFICATION).createNotifications({
    to: order.email,
    channel: "email",
    template: "einvoice-issued",
    data: { document_number: data.document_number, type: data.type },
    attachments: [
      {
        filename: `${data.document_number}.${document.pdf_file_id ? "pdf" : "xml"}`,
        content: bytes.toString("base64"),
        content_type: document.pdf_file_id ? "application/pdf" : "application/xml",
      },
    ],
    // An event can come more than once: one mail per document.
    idempotency_key: `einvoice-issued:${data.id}`,
  });
}

export const config: SubscriberConfig = { event: "einvoice.document_issued" };
```

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
aren't published to npm yet — this run substituted `yalc` for step 1's `npm install`, `medusa-config.ts`
was edited exactly as shown, and every other step ran unmodified. Once these packages are published to npm
for real, this quickstart should be re-run once against the actual npm registry
before being called final — a `yalc`-substituted install is a faithful stand-in for module resolution, but
not for npm's own package resolution/version constraints.
