# E-invoice dry run

`@normwerk/einvoice-medusa` 0.1.0 on Medusa 2.21.2, started 2026-10-07 12:00 UTC.

What the plugin would have done with these orders had it been running: the documents it would issue, issue with a notice or refuse, and why. Nothing was issued — no document number was taken, no file stored, no event sent. This is a technical check of the shop's data and setup, not tax advice.

## Run

- **Selection:** fulfillments created from 2026-09-01 to 2026-09-30 — 26 orders, 30 fulfillments.
- **Skipped:** 0 fulfillments already invoiced by the plugin, 1 cancelled before an invoice was issued.
- **VAT-IDs:** 3 distinct checked — 2 confirmed, 0 not confirmed; for 1 the verifier gave no answer.
- **Plugin:** `@normwerk/einvoice-medusa` 0.1.0; core `@normwerk/einvoice-commerce` 0.1.0, `@normwerk/einvoice-cii` 0.1.0, `@normwerk/einvoice-model` 0.1.0.
- **VAT rules:** SHA-256 `e29a5da1d7450f8d2946f22431bc90310a833e2e4fe3a78d4aca3961dd7937a1`.
- **Platform:** Medusa 2.21.2, Node.js 22.12.0.
- **Validators:** kosit-validator 1.6.3; xrechnung-validator-configuration XRechnung 3.0.2, release v2026-08-31; mustang-cli 2.26.0.
- **Report format:** version 1.

## Shop setup

| Check | Result | Details |
| --- | --- | --- |
| Medusa version | pass | 2.21.2; the plugin runs on 2.12–2.15, 2.18 or a later 2.x |
| Plugin migrations | pass | All applied |
| Plugin options | pass | Complete |
| VAT rates | pass | DE charges VAT; no rate in the tax region of FR, where Medusa charges no VAT |
| Other invoice plugins | **warn** | `@webbers/invoices-medusa`: with both running, a sale gets two invoices, and the VAT stated on each is owed |
| File storage | pass | `@medusajs/medusa/file-local` |
| VAT-ID verifier | pass | Configured |
| Validators | pass | Ran; their versions are under Run |

## Outcomes

| Outcome | Documents |
| --- | ---: |
| Would issue | 18 |
| Would issue, with a notice | 3 |
| Would refuse | 6 |
| Not assessed | 6 |
| Tool error | 1 |
| **All** | **34** |

Validated: of the 21 documents the plugin would issue, 20 valid, 0 valid with warnings, 1 invalid — see Validation.

## Would refuse

The plugin would not issue these documents. It records why and takes no document number; the merchant corrects the order and retries, or issues the document another way.

### `INVOICE_VAT_ABOVE_CHARGED` — 1

The invoice would state more VAT than Medusa charged, and so a higher total than the buyer paid — VAT stated on an invoice is owed (§14c UStG). [What to do](https://normwerk.dev/einvoice/docs/errors#invoice-vat-above-charged).

- Order `order_s13`, invoice for fulfillment `ful_s13`

### `NO_VAT_CHARGED` — 1

No line and no shipping of a domestic order carries VAT: the shop charged none. [What to do](https://normwerk.dev/einvoice/docs/errors#no-vat-charged).

- Order `order_s20`, invoice for fulfillment `ful_s20`

### `SHIPMENT_OF_CLAIM_REPLACEMENT` — 1

A fulfillment ships a replacement from a claim. [What to do](https://normwerk.dev/einvoice/docs/errors#shipment-of-claim-replacement).

- Order `order_s22_claim`, invoice for fulfillment `ful_s22_claim_2`

### `SHIPMENT_OF_EXCHANGE` — 1

A fulfillment ships the new item of an exchange. [What to do](https://normwerk.dev/einvoice/docs/errors#shipment-of-exchange).

- Order `order_s22_exchange`, invoice for fulfillment `ful_s22_exchange_2`

### `UNSUPPORTED_BUYER_COUNTRY_CLEARANCE` — 1

The buyer's country — Italy or Poland — runs a mandatory clearance platform with its own national XML; no EN 16931 document can be submitted through it. [What to do](https://normwerk.dev/einvoice/docs/errors#unsupported-buyer-country-clearance).

- Order `order_s17`, invoice for fulfillment `ful_s17` — buyer in IT

### `VAT_ID_UNVERIFIED` — 1

An intra-EU supply (category K) needs the buyer's VAT-ID confirmed valid — a positive VIES check — or a declared manual confirmation (regime override `intra-eu-confirmed`). [What to do](https://normwerk.dev/einvoice/docs/errors#vat-id-unverified).

- Order `order_s14`, invoice for fulfillment `ful_s14`

## Would issue, with a notice

The plugin would issue these documents and tell the merchant something to act on.

### `VAT_OVERCHARGED` — 2

Prices without VAT: the invoice states less VAT than Medusa charged — typically a business buyer in another EU member state, invoiced at 0 % — and the buyer paid the difference on top. [What to do](https://normwerk.dev/einvoice/docs/errors#vat-overcharged).

- Order `order_s12`, invoice for fulfillment `ful_s12`
- Order `order_s15`, invoice for fulfillment `ful_s15` — the invoice splits shipping across the order's VAT rates, the shop taxes it at one

### `VAT_DIFFERS_FROM_MEDUSA` — 1

Prices including VAT: the buyer paid the invoice total, but Medusa counts a different VAT than the invoice. [What to do](https://normwerk.dev/einvoice/docs/errors#vat-differs-from-medusa).

- Order `order_s16`, invoice for fulfillment `ful_s16`

## Tool errors

The dry run failed on these documents. That is a defect in the plugin — what the run is there to find. Please report each one: the link opens a form filled in with the versions, the code and the stack below, and nothing from the order.

### `INTERNAL_ERROR`, `TypeError` — 1

Fingerprint `3f9a0c1d2e4b`, while planning the document.

```text
at mapOrderToCommerceInvoiceInput (@normwerk/einvoice-medusa/.medusa/server/src/mapping/order-to-commerce-invoice-input.js:412:31)
at prepare (@normwerk/einvoice-medusa/.medusa/server/src/invoices/issue-invoice.js:268:19)
at planInvoiceForFulfillment (@normwerk/einvoice-medusa/.medusa/server/src/invoices/issue-invoice.js:316:16)
… 4 frames outside the @normwerk packages
```

[Report it](https://github.com/normwerk/einvoice/issues/new?template=bug.yml&title=Dry+run%3A+INTERNAL_ERROR+%28TypeError%29%2C+fingerprint+3f9a0c1d2e4b&versions=%40normwerk%2Feinvoice-medusa+0.1.0%2C+%40normwerk%2Feinvoice-commerce+0.1.0%2C+%40normwerk%2Feinvoice-cii+0.1.0%2C+%40normwerk%2Feinvoice-model+0.1.0&platform=Medusa+2.21.2%2C+Node.js+22.12.0&code=INTERNAL_ERROR&what=The+dry+run+failed+while+planning+the+document.%0A%0A%60%60%60text%0ATypeError+%5BINTERNAL_ERROR%5D%0A++++at+mapOrderToCommerceInvoiceInput+%28%40normwerk%2Feinvoice-medusa%2F.medusa%2Fserver%2Fsrc%2Fmapping%2Forder-to-commerce-invoice-input.js%3A412%3A31%29%0A++++at+prepare+%28%40normwerk%2Feinvoice-medusa%2F.medusa%2Fserver%2Fsrc%2Finvoices%2Fissue-invoice.js%3A268%3A19%29%0A++++at+planInvoiceForFulfillment+%28%40normwerk%2Feinvoice-medusa%2F.medusa%2Fserver%2Fsrc%2Finvoices%2Fissue-invoice.js%3A316%3A16%29%0A++++%E2%80%A6+4+frames+outside+the+%40normwerk+packages%0A%60%60%60)

- Order `order_illustrative_tool_error`, invoice for fulfillment `ful_illustrative_tool_error`

## Not assessed

What this dry run cannot judge — a limit of the run, not a finding about the shop.

### `CREDIT_NOTES_NOT_ASSESSED` — 5

This release's dry run plans invoices only: the refunds and cancellations below are listed, not planned.

- Order `order_s04`, credit note for refund `ref_s04`
- Order `order_s05`, credit note for refund `ref_s05`
- Order `order_s06`, credit note for the order's cancellation
- Order `order_s12`, credit note for refund `ref_s12`
- Order `order_s22_exchange`, credit note for refund `ref_s22_exchange`

### `ORDER_CHANGED_AFTER_SHIPMENT` — 1

These orders changed after the fulfillment. The run reads an order as it is now, not as it was when the invoice would have been issued, so it does not judge the invoice.

- Order `order_s22_edit`, invoice for fulfillment `ful_s22_edit` — edited

## Would issue

| Profile | Would issue | With a notice |
| --- | ---: | ---: |
| EN 16931 | 17 | 3 |
| XRechnung | 1 | 0 |

Each document is listed in the JSON report.

## Validation

The XML of every document the plugin would issue went through the validators listed under Run, with a placeholder for the document number, which the plugin takes only when it issues.

### Invalid — 1

The plugin would issue these documents, and the validators reject them: a defect in the plugin. Please report it on the [bug form](https://github.com/normwerk/einvoice/issues/new?template=bug.yml) with the rule ids below — never with the document.

- Order `order_illustrative_invalid`, invoice for fulfillment `ful_illustrative_invalid` — KoSIT: BR-CO-15; Mustang: BR-CO-15

## What this report does not tell you

- **Whether the VAT is right.** Validators check a document's structure and business rules, not whether the VAT category, rate or exemption is the right one for the sale: a document with the wrong category can pass them. What the plugin decides, and on which grounds: [tax semantics](https://normwerk.dev/einvoice/docs/tax-semantics).
- **VAT-IDs as they were.** The verifier answers for the day of the run, not for the day of the order.
- **The shop's own PDF.** The shop renders its own PDF for the invoices. The run does not call it, so whether that PDF can become PDF/A-3 is not assessed; the XML is.
- **Tax advice.** This is a technical check. Questions about the VAT treatment of a sale go to the merchant's own tax advisor.
