# Dry run: the plugin over your past orders, before you turn it on

Back to [`docs/README.md`](README.md).

The dry run takes a period of your shop's orders and tells you, for every fulfillment, what
`@normwerk/einvoice-medusa` would have done had it been running: issued the invoice, issued it with a notice,
or refused it — and why. It issues nothing. No document number is taken, no file is stored, no event is
sent, no refusal is recorded. You get a report that names no customer, and you can send it on.

Use it before you install the plugin in production, after you upgrade it, or when someone checks a shop's
readiness for e-invoicing on its real orders. It is a technical check of your data and setup, not tax advice.

## What you need

- **A staging copy of your shop**: the same Medusa release and configuration, with a copy of the production
  database. Not production itself — the run reads every order in the period and checks each buyer's VAT-ID.
- **The plugin installed and configured on that copy** — [Quickstart](quickstart-medusa.md) steps 1–3:
  install, the options in `medusa-config.ts`, the migrations. The plugin does not start with incomplete
  options or on a Medusa release it does not support, and then the dry run cannot start either. Configure
  the VAT-ID verifier as you would in production: without one, an intra-EU sale to a business is refused
  unless its VAT-ID was confirmed by hand on the order.
- **For the validators** (optional, recommended): a machine with Docker and `git`. Without them you still get
  the report, marked "validators not run".

With the plugin in `medusa-config.ts`, a Medusa server you start on the staging copy issues invoices for what
is fulfilled there. The dry run does not need a running server: it runs in Medusa's own `exec`, which loads
the plugin's options and none of its subscribers.

## 1. Run it

In the Medusa app's folder on the staging copy:

```bash
npx medusa exec ./node_modules/@normwerk/einvoice-medusa/.medusa/server/src/scripts/einvoice-dry-run.js from=2026-09-01 to=2026-09-30 out=einvoice-dry-run
```

| Argument                        | What it does                                                                                                                                  |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `from=YYYY-MM-DD to=YYYY-MM-DD` | Every fulfillment created in this period, both days included, in the seller's time zone                                                       |
| `orders=<id>,<id>`              | These orders instead of a period (Medusa's order ids, `order_…`)                                                                              |
| `out=<folder>`                  | Where the results go; `einvoice-dry-run` if not given. A new or empty folder, or the folder of an earlier dry run, whose results are replaced |

The folder then holds two things:

- `report.json` — the report, without personal data: internal ids, counts, codes, versions.
- `xml/` — the XML of every invoice the plugin would issue. **It names your buyers**: keep it on the staging
  machine, and do not send it anywhere.

An order's fulfillments are planned in the order they were created, so the second invoice of an order shipped
in two parts carries what the first left: the shipping on the first only, as the plugin issues them. In a
shop that already runs the plugin, fulfillments it has invoiced are skipped and counted.

## 2. Validate the XML and write the report

On a machine with Docker, from a copy of this repository at the plugin's version (the report's header names
it):

```bash
git clone --depth 1 --branch v<version> https://github.com/normwerk/einvoice.git
cd einvoice
docker compose -f docker/compose.conformance.yml build kosit mustang
npx @normwerk/einvoice-conformance dry-run /path/to/einvoice-dry-run
```

This puts each invoice's XML through the KoSIT Validator (XRechnung and EN 16931 rules) and through Mustang,
writes their verdicts into `report.json`, and writes `report.md` next to it. The two images are the ones,
at the versions, the repository's own conformance suite uses (`docker/images.lock`). Without Docker, the same command writes `report.md` with the validators
marked as not run — which is never the same as valid.

The XML has to be on the machine that runs this step: copy the whole folder there, or run both steps on the
staging machine.

## Reading the report

The report opens with the run — the period, how many orders and fulfillments, the versions of the plugin,
Medusa and the packages, and a SHA-256 of the VAT rules applied — and the shop's setup: the Medusa release,
the plugin's migrations, the VAT rate of each tax region, other plugins that issue invoices, the file storage
and the VAT-ID verifier. Then every document gets one of five outcomes:

| Outcome                        | What it means                                                                                                                                                                                        |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Would issue**                | The plugin would issue this invoice as it is.                                                                                                                                                        |
| **Would issue, with a notice** | It would issue it and tell you something to act on — for example a refund due because Medusa charged VAT the invoice does not state.                                                                 |
| **Would refuse**               | It would not issue it. The report gives the code, one sentence on what it means, and a link to its entry in the [error reference](https://normwerk.dev/einvoice/docs/errors), which says what to do. |
| **Not assessed**               | The dry run cannot tell — a limit of the run, not a finding about your shop (below).                                                                                                                 |
| **Tool error**                 | The run itself failed on this document. That is a defect in the plugin; please report it (below).                                                                                                    |

The refusals are the part to read first. Most are settings or data — a tax region without a rate, a VAT-ID
the verifier could not confirm, a buyer country this release does not support — and the error reference
says which. Each code is listed once with the documents it applies to (twenty per code; `report.json` has
all of them).

If the validators ran, the report also says how many invoices they found valid. An invoice the plugin would
issue and a validator rejects is a defect in the plugin: the report lists the rules that failed — please
report it.

### What the dry run does not assess

- **Credit notes.** Refunds and cancellations are listed, not planned, in this release.
- **Orders that changed after the fulfillment.** The run reads each order as it is now, not as it was when the
  invoice would have been issued. A fulfillment whose order was edited, exchanged, claimed or had its
  details changed afterwards, or an item of which came back, is not assessed; the report says which change.
  Its invoice is still counted for the order's next ones.
- **Your own PDF.** If the shop renders its own PDF for the invoices, the run does not call it, so whether
  that PDF can become PDF/A-3 is not assessed. The XML is.

And what no report of this kind tells you:

- **Whether the VAT is right.** Validators check a document's structure and business rules, not whether the
  VAT category, rate or exemption is the right one for the sale. What the plugin decides, and on which
  grounds: [tax semantics](tax-semantics.md).
- **VAT-IDs as they were.** The verifier answers for the day of the run, not for the day of the order.

Questions about the VAT treatment of a sale go to your own tax advisor.

## What to send us

- **A tool error**: each one in the report has a "Report it" link that opens the repository's bug form,
  filled in with the versions, the error's code and the stack of our own code — nothing from the order.
- **An invoice a validator rejects, or a refusal you think is wrong**: the
  [bug form](https://github.com/normwerk/einvoice/issues/new?template=bug.yml), with the code and the rules from
  the report, and the order described in made-up data.
- **The report itself**, if you want us to look at it: `report.md` or `report.json`. Never the `xml/` folder,
  and never a real invoice, name, address or VAT-ID.

## Why it changes nothing

The run calls the plugin's own decision — the same code that decides when an order is fulfilled — and none of
the steps that follow it: no document number, no file, no record, no event, no PDF. The plugin's end-to-end
suite runs the dry run over every order of its test shop, on a copy of the database, and checks that every row
of that database is the same afterwards and no file was stored, that every fulfillment the run assesses gets
the outcome the plugin gave it when the order was fulfilled, and that the report contains none of the buyers'
names, addresses, postcodes, telephone numbers or email addresses. An example of the report's format, written by hand:
[`example-report.md`](../packages/einvoice-conformance/src/dry-run/__fixtures__/example-report.md).
