/**
 * T-033: whether a PDF someone else rendered can become PDF/A-3 by `embedInvoiceInPdfA3`, which adds the
 * attachment, XMP and OutputIntent but repairs nothing. Two defects it cannot get past, checked here with
 * `pdf-lib` alone: encryption (PDF/A forbids it) and a font whose program is not embedded — the classic case is
 * a standard font such as Helvetica, referenced by name only (veraPDF rule 6.2.11.4.1, "font programs … shall
 * be embedded"). Re-embedding a font takes a font renderer such as Ghostscript, which is never run inside this
 * package.
 *
 * Fonts are looked for among the document's indirect objects and in every page's own resources. A Type0 font
 * is judged by its descendant (a font object of its own); a Type3 font is drawn by the PDF itself and passes.
 */
import { PDFDict, PDFDocument, PDFName, PDFRef } from "pdf-lib";

export type PdfAEligibility =
  | { readonly eligible: true }
  | { readonly eligible: false; readonly reason: "encrypted" }
  | { readonly eligible: false; readonly reason: "font-not-embedded"; readonly fontName: string };

const FONT_FILES = ["FontFile", "FontFile2", "FontFile3"].map((key) => PDFName.of(key));

/** The font's name as the PDF states it, without the leading slash of PDF name syntax. */
function fontName(font: PDFDict): string {
  return (font.lookupMaybe(PDFName.of("BaseFont"), PDFName)?.asString() ?? "(unnamed)").replace(
    /^\//,
    "",
  );
}

function isFont(dict: PDFDict): boolean {
  return dict.lookupMaybe(PDFName.of("Type"), PDFName)?.asString() === "/Font";
}

/** A font dict whose program is not in the PDF, if there is one among `fonts`. */
function unembedded(fonts: Iterable<PDFDict>): PDFDict | undefined {
  for (const font of fonts) {
    const subtype = font.lookupMaybe(PDFName.of("Subtype"), PDFName)?.asString();
    if (subtype === "/Type0" || subtype === "/Type3") continue;
    const descriptor = font.lookupMaybe(PDFName.of("FontDescriptor"), PDFDict);
    if (descriptor === undefined || !FONT_FILES.some((key) => descriptor.has(key))) return font;
  }
  return undefined;
}

export async function checkPdfAEligibility(pdfBytes: Uint8Array): Promise<PdfAEligibility> {
  const doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true, updateMetadata: false });
  if (doc.isEncrypted) return { eligible: false, reason: "encrypted" };

  const fonts: PDFDict[] = [];
  for (const [, object] of doc.context.enumerateIndirectObjects()) {
    if (object instanceof PDFDict && isFont(object)) fonts.push(object);
  }
  for (const page of doc.getPages()) {
    const pageFonts = page.node.Resources()?.lookupMaybe(PDFName.of("Font"), PDFDict);
    for (const [, value] of pageFonts?.entries() ?? []) {
      const font = value instanceof PDFRef ? doc.context.lookup(value) : value;
      if (font instanceof PDFDict) fonts.push(font);
    }
  }
  const missing = unembedded(fonts);
  return missing === undefined
    ? { eligible: true }
    : { eligible: false, reason: "font-not-embedded", fontName: fontName(missing) };
}
