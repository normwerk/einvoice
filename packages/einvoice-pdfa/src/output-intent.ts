/**
 * T-030: PDF/A-3b `/OutputIntents` entry — low-level pdf-lib primitives, the
 * same approach Spike B validated (HOW-WE-GOT-HERE.md D-20, "Path 1 — pure
 * pdf-lib"). pdf-lib has no high-level helper for this; the shape itself
 * (`/S /GTS_PDFA1`, `/OutputConditionIdentifier`, `/DestOutputProfile`) is
 * the standard ISO 19005 OutputIntent dictionary, used the same way across
 * PDF/A-1/2/3 — not something specific to us to verify against an artifact.
 */
import { PDFDict, PDFDocument, PDFName, PDFString } from "pdf-lib";
import { srgbIccProfileBytes } from "./generated/srgb-icc-profile.js";

const CONDITION_IDENTIFIER = "sRGB IEC61966-2.1";

export function addSrgbOutputIntent(pdfDoc: PDFDocument): void {
  const context = pdfDoc.context;
  const iccStream = context.flateStream(srgbIccProfileBytes(), {
    N: 3,
    Alternate: PDFName.of("DeviceRGB"),
  });
  const iccRef = context.register(iccStream);

  // Built with explicit PDFString values, not `context.obj({...})`'s literal
  // shorthand: a plain JS string there becomes a PDFName (per its own type
  // signature, `obj(literal: string): PDFName`) — correct for `/S` and
  // `/Type`, but OutputConditionIdentifier/Info are PDF *text* strings per
  // spec. Found via a real veraPDF run: passing plain strings for those
  // produced the warning "Missing OutputConditionIdentifier in an output
  // intent dictionary" — veraPDF didn't recognize the misencoded value.
  const outputIntent = PDFDict.withContext(context);
  outputIntent.set(PDFName.of("Type"), PDFName.of("OutputIntent"));
  outputIntent.set(PDFName.of("S"), PDFName.of("GTS_PDFA1"));
  outputIntent.set(PDFName.of("OutputConditionIdentifier"), PDFString.of(CONDITION_IDENTIFIER));
  outputIntent.set(PDFName.of("Info"), PDFString.of(CONDITION_IDENTIFIER));
  outputIntent.set(PDFName.of("DestOutputProfile"), iccRef);
  const outputIntentRef = context.register(outputIntent);

  pdfDoc.catalog.set(PDFName.of("OutputIntents"), context.obj([outputIntentRef]));
}
