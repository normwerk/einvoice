/**
 * T-033: the PDF of a document — the merchant's own (`standalone.basePdf`) with the XML embedded as PDF/A-3,
 * when it can be. `embedInvoiceInPdfA3` repairs nothing, so the PDF is checked first
 * (`checkPdfAEligibility`, `@normwerk/einvoice-pdfa`): encrypted, or with a font whose program it does not
 * embed, it cannot become PDF/A. The document is then issued as XML alone — the XML is the e-invoice — and
 * carries a notice saying why, with a code. `basePdf` runs after the number is taken (the PDF shows it), so a
 * refusal here would lose the number; issuing the XML loses nothing.
 */
import type { ZugferdProfileName } from "@normwerk/einvoice-pdfa" with {
  "resolution-mode": "import",
};

/** Why a document was issued without its PDF. */
export type PdfNoticeCode =
  /** Issued as XML alone: the PDF from `standalone.basePdf` uses a font it does not embed — typically a
   * standard font such as Helvetica — and PDF/A requires every font embedded. Embed the fonts where the PDF
   * is rendered, or use `renderInvoicePdf`. */
  | "PDF_FONT_NOT_EMBEDDED"
  /** Issued as XML alone: the PDF from `standalone.basePdf` is encrypted, which PDF/A does not allow. */
  | "PDF_ENCRYPTED";

export interface PdfNotice {
  readonly code: PdfNoticeCode;
  /** For `PDF_FONT_NOT_EMBEDDED`, the font as the PDF names it. */
  readonly fontName?: string;
}

/** The merchant-facing explanation — the log and the admin widget show it. */
export function describePdfNotice(notice: PdfNotice): string {
  return notice.code === "PDF_ENCRYPTED"
    ? "Issued as XML only: the PDF from standalone.basePdf is encrypted, which PDF/A does not allow."
    : `Issued as XML only: the PDF from standalone.basePdf uses the font ${notice.fontName ?? "(unnamed)"} ` +
        "without embedding it, and PDF/A requires every font embedded. Embed the fonts where the PDF is " +
        "rendered, or use renderInvoicePdf.";
}

/** The document's PDF/A-3 bytes, or none with the notice saying why. */
export async function documentPdf(
  basePdfBytes: Uint8Array | undefined,
  xml: string,
  options: { readonly profile: ZugferdProfileName; readonly title: string },
): Promise<{ readonly pdfBytes: Uint8Array | undefined; readonly pdfNotice: PdfNotice | null }> {
  if (basePdfBytes === undefined) return { pdfBytes: undefined, pdfNotice: null };
  const pdfa = await import("@normwerk/einvoice-pdfa");
  const eligibility = await pdfa.checkPdfAEligibility(basePdfBytes);
  if (!eligibility.eligible) {
    return {
      pdfBytes: undefined,
      pdfNotice:
        eligibility.reason === "encrypted"
          ? { code: "PDF_ENCRYPTED" }
          : { code: "PDF_FONT_NOT_EMBEDDED", fontName: eligibility.fontName },
    };
  }
  const { pdfBytes } = await pdfa.embedInvoiceInPdfA3(basePdfBytes, xml, options);
  return { pdfBytes, pdfNotice: null };
}
