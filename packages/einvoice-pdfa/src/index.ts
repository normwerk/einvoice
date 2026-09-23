/**
 * T-030: `@normwerk/einvoice-pdfa` — embeds an EN 16931 CII invoice XML
 * (produced by `@normwerk/einvoice-cii`) into an existing PDF, turning it
 * into a PDF/A-3b ZUGFeRD/Factur-X document.
 *
 * Approach validated by Spike B (T-031, HOW-WE-GOT-HERE.md D-20): pure
 * pdf-lib, no Ghostscript — this function does not attempt to fix a PDF
 * that isn't already PDF/A-eligible (e.g. one using non-embedded standard
 * fonts); that repair step (D-20's "Path 2") is a documented follow-up
 * (T-030 continuation), not implemented here. The input PDF is assumed to
 * be under the caller's control in that sense — "not under our control"
 * (per plan-v0.1) means its *content*, not its font-embedding correctness.
 *
 * Deliberately does not touch the document's Info dictionary (Creator/
 * Producer/CreationDate/ModDate) — matches this repo's determinism
 * discipline (ADR-004: no `Date.now()`, no incidental non-determinism):
 * `pdf-lib`'s own `save()` doesn't touch it either, only `PDFDocument.create()`
 * does, which this function never calls.
 */
import { AFRelationship, PDFDocument, PDFHexString, PDFName } from "pdf-lib";
import { createHash } from "node:crypto";
import { addSrgbOutputIntent } from "./output-intent.js";
import { buildXmpPacket } from "./xmp.js";
import { ZUGFERD_PROFILES, type ZugferdProfileName } from "./profiles.js";

export type { ZugferdProfileName, ZugferdProfile } from "./profiles.js";
// T-073: re-exported (previously test-only, `render-invoice.test.ts`) so a caller with no PDF of its own
// (`einvoice-medusa`'s standalone mode, plan-v0.1 §4.6 — "XML + PDF/A-3 из переданного PDF" needs a PDF
// to pass in the first place) has a real, font-embedded, PDF/A-eligible one to hand to
// `embedInvoiceInPdfA3` instead of nothing — not a hypothetical convenience, `einvoice-medusa`'s own
// standalone e2e proof (T-073) uses exactly this as the "merchant's own PDF renderer".
export { renderInvoicePdf } from "./render-invoice.js";

export interface EmbedInvoiceOptions {
  /** Which ZUGFeRD/Factur-X profile's XMP metadata and attachment filename to use. */
  readonly profile: ZugferdProfileName;
  /** dc:title in the XMP metadata (e.g. the invoice number, BT-1). Optional. */
  readonly title?: string;
}

export interface EmbedInvoiceResult {
  readonly pdfBytes: Uint8Array;
  readonly attachmentFilename: string;
}

/**
 * Deterministic trailer /ID (ADR-004: content-derived, not random/time-based).
 * PDF/A requires a file identifier; a fresh document conventionally uses the
 * same value for both halves of the pair.
 */
function deterministicIdHex(
  basePdfBytes: Uint8Array,
  invoiceXml: string,
  profile: ZugferdProfileName,
): string {
  const hash = createHash("sha256");
  hash.update(basePdfBytes);
  hash.update(invoiceXml, "utf-8");
  hash.update(profile, "utf-8");
  return hash.digest("hex").slice(0, 32); // 16 bytes, the conventional /ID length
}

/**
 * Embeds `invoiceXml` into `basePdfBytes` and adds the PDF/A-3b machinery
 * (sRGB OutputIntent, XMP metadata with the ZUGFeRD/Factur-X extension
 * schema). Does not itself verify the result is PDF/A-3b-valid — run the
 * real veraPDF/Mustang validators (tools/conformance/pdfa-embed-and-validate.mjs)
 * for that, per this repo's "never simulate conformance" rule (AGENTS.md §8).
 */
export async function embedInvoiceInPdfA3(
  basePdfBytes: Uint8Array,
  invoiceXml: string,
  options: EmbedInvoiceOptions,
): Promise<EmbedInvoiceResult> {
  const profile = ZUGFERD_PROFILES[options.profile];
  // updateMetadata: false — PDFDocument.load()'s own default (true) silently
  // stamps the Info dict's ModDate (and, if the base PDF has none yet,
  // CreationDate too) with the real `new Date()` at load time. Found by
  // actually diffing two calls a second apart, not by reading the source
  // alone: the "embedding twice gives byte-identical output" unit test
  // below only passed by accident of running faster than one second.
  // Without this, this function's own doc comment above ("does not touch
  // the document's Info dictionary... matches this repo's determinism
  // discipline") would be false.
  const pdfDoc = await PDFDocument.load(basePdfBytes, { updateMetadata: false });

  addSrgbOutputIntent(pdfDoc);

  const xmpPacket = buildXmpPacket({
    profile,
    ...(options.title !== undefined ? { title: options.title } : {}),
  });
  // Encoded to UTF-8 bytes here, not passed as a string: pdf-lib turns a string argument into one byte per
  // UTF-16 code unit (truncating), so the xpacket BOM became 0xFF and any non-ASCII title was corrupted —
  // an XMP packet that isn't valid UTF-8 (P-42).
  const metadataStream = pdfDoc.context.stream(new TextEncoder().encode(xmpPacket), {
    Type: "Metadata",
    Subtype: "XML",
  });
  const metadataRef = pdfDoc.context.register(metadataStream);
  pdfDoc.catalog.set(PDFName.of("Metadata"), metadataRef);

  // AFRelationship.Alternative: per Factur-X §6.2.2, "identical content in
  // two forms" — and the mandatory choice for Germany specifically (the
  // XRechnung/German legal context this repo targets).
  await pdfDoc.attach(new TextEncoder().encode(invoiceXml), profile.attachmentFilename, {
    mimeType: "application/xml",
    afRelationship: AFRelationship.Alternative,
    description: `${profile.name} invoice XML (EN 16931 / ${profile.name === "XRECHNUNG" ? "XRechnung 3.0" : "Factur-X"})`,
  });

  const idHex = deterministicIdHex(basePdfBytes, invoiceXml, options.profile);
  pdfDoc.context.trailerInfo.ID = pdfDoc.context.obj([
    PDFHexString.of(idHex),
    PDFHexString.of(idHex),
  ]);

  const pdfBytes = await pdfDoc.save();
  return { pdfBytes, attachmentFilename: profile.attachmentFilename };
}
