# @normwerk/einvoice-pdfa

## 0.1.0

### Minor Changes

- First release. `embedInvoiceInPdfA3` embeds the CII XML into a PDF as a PDF/A-3b ZUGFeRD / Factur-X
  hybrid — output intent, XMP metadata and the XML attachment. `checkPdfAEligibility` tells beforehand
  whether a PDF can become PDF/A: an encrypted PDF, or one using a font it does not embed, cannot, and is
  not repaired. `renderInvoicePdf` draws a plain A4 invoice or credit note, fonts embedded, for a shop with
  no PDF of its own. Checked by veraPDF and Mustang.

### Patch Changes

- Updated dependencies
  - @normwerk/einvoice-model@0.1.0
