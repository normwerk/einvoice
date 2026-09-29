# @normwerk/einvoice-medusa

## 0.1.0

### Minor Changes

- First release. A Medusa v2 plugin (Medusa 2.12–2.15, and 2.18 or a later 2.x release) for a seller in
  Germany: an invoice when an order is fulfilled — for what that shipment ships — and a credit note,
  referencing the invoice, when the order is refunded or cancelled. XRechnung 3.0 or ZUGFeRD / Factur-X,
  optionally as a PDF/A-3 hybrid from the bundled renderer or the shop's own PDF. Documents are stored
  privately and can be downloaded in Medusa Admin and, by the customer, through the Store API. A refused
  document shows its reason and code in the order's "E-Invoices" block and can be issued again; exchanges
  and warranty replacements are refused visibly, and a price edited after the invoice is noted. The plugin
  does not start for a seller outside Germany or on a Medusa release it has not been shown to work on.

### Patch Changes

- Updated dependencies
  - @normwerk/einvoice-model@0.1.0
  - @normwerk/einvoice-commerce@0.1.0
  - @normwerk/einvoice-cii@0.1.0
  - @normwerk/einvoice-pdfa@0.1.0
