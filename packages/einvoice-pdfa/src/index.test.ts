import { describe, expect, it } from "vitest";
import {
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRawStream,
  PDFStream,
  decodePDFRawStream,
} from "pdf-lib";
import { embedInvoiceInPdfA3 } from "./index.js";
import { buildXmpPacket } from "./xmp.js";
import { ZUGFERD_PROFILES } from "./profiles.js";

const SAMPLE_XML =
  '<?xml version="1.0" encoding="UTF-8"?><rsm:CrossIndustryInvoice><!-- sample --></rsm:CrossIndustryInvoice>';

async function blankBasePdf(): Promise<Uint8Array> {
  // No text, no fonts — sidesteps the "non-embedded standard font" PDF/A
  // pitfall entirely (Spike B, D-20) rather than needing a vendored,
  // embeddable font just for this test fixture.
  const doc = await PDFDocument.create();
  doc.addPage([200, 200]);
  return doc.save();
}

/** Finds the (Flate-decoded) bytes of the embedded /Type /EmbeddedFile stream, without hand-walking the /Names tree. */
function findEmbeddedFileBytes(pdfDoc: PDFDocument): Uint8Array {
  for (const [, object] of pdfDoc.context.enumerateIndirectObjects()) {
    if (object instanceof PDFRawStream) {
      const type = object.dict.lookupMaybe(PDFName.of("Type"), PDFName);
      if (type?.asString() === "/EmbeddedFile") {
        return decodePDFRawStream(object).decode();
      }
    }
  }
  throw new Error("no embedded file stream found");
}

describe("buildXmpPacket", () => {
  it("declares the pdfaExtension:schemas block before the fx: properties it describes (T-030)", () => {
    const xmp = buildXmpPacket({ profile: ZUGFERD_PROFILES.EN16931, title: "RE-2026-0001" });
    const extensionIndex = xmp.indexOf("pdfaExtension:schemas");
    const fxProps = xmp.indexOf("<fx:DocumentType>");
    expect(extensionIndex).toBeGreaterThan(-1);
    expect(fxProps).toBeGreaterThan(extensionIndex);
  });

  it("EN16931 profile: XMP conformance level has the real space ('EN 16931', not 'EN16931')", () => {
    const xmp = buildXmpPacket({ profile: ZUGFERD_PROFILES.EN16931 });
    expect(xmp).toContain("<fx:ConformanceLevel>EN 16931</fx:ConformanceLevel>");
    expect(xmp).toContain("<fx:DocumentFileName>factur-x.xml</fx:DocumentFileName>");
  });

  it("XRECHNUNG profile: attachment filename is xrechnung.xml, not factur-x.xml", () => {
    const xmp = buildXmpPacket({ profile: ZUGFERD_PROFILES.XRECHNUNG });
    expect(xmp).toContain("<fx:ConformanceLevel>XRECHNUNG</fx:ConformanceLevel>");
    expect(xmp).toContain("<fx:DocumentFileName>xrechnung.xml</fx:DocumentFileName>");
  });

  it("escapes XML-special characters in the title", () => {
    const xmp = buildXmpPacket({ profile: ZUGFERD_PROFILES.EN16931, title: "A & B <test>" });
    expect(xmp).toContain("A &amp; B &lt;test&gt;");
    expect(xmp).not.toContain("A & B <test>");
  });
});

describe("embedInvoiceInPdfA3", () => {
  it("adds a catalog /OutputIntents entry with the vendored sRGB profile", async () => {
    const base = await blankBasePdf();
    const { pdfBytes } = await embedInvoiceInPdfA3(base, SAMPLE_XML, { profile: "EN16931" });
    const reloaded = await PDFDocument.load(pdfBytes);
    const outputIntents = reloaded.catalog.lookup(PDFName.of("OutputIntents"));
    expect(outputIntents).toBeDefined();
  });

  it("adds a catalog /Metadata XMP stream containing the expected fx: properties", async () => {
    const base = await blankBasePdf();
    const { pdfBytes } = await embedInvoiceInPdfA3(base, SAMPLE_XML, { profile: "XRECHNUNG" });
    const reloaded = await PDFDocument.load(pdfBytes);
    const metadata = reloaded.catalog.lookup(PDFName.of("Metadata"), PDFStream);
    const xmpText = new TextDecoder().decode(decodePDFRawStream(metadata as PDFRawStream).decode());
    expect(xmpText).toContain("<fx:ConformanceLevel>XRECHNUNG</fx:ConformanceLevel>");
    expect(xmpText).toContain("<pdfaid:part>3</pdfaid:part>");
  });

  it("embeds the invoice XML byte-for-byte (round-trips through Flate decoding)", async () => {
    const base = await blankBasePdf();
    const { pdfBytes, attachmentFilename } = await embedInvoiceInPdfA3(base, SAMPLE_XML, {
      profile: "EN16931",
    });
    expect(attachmentFilename).toBe("factur-x.xml");
    const reloaded = await PDFDocument.load(pdfBytes);
    const extracted = new TextDecoder().decode(findEmbeddedFileBytes(reloaded));
    expect(extracted).toBe(SAMPLE_XML);
  });

  it("is deterministic: embedding twice from the same inputs gives byte-identical output", async () => {
    const base = await blankBasePdf();
    const first = await embedInvoiceInPdfA3(base, SAMPLE_XML, {
      profile: "EN16931",
      title: "RE-2026-0001",
    });
    const second = await embedInvoiceInPdfA3(base, SAMPLE_XML, {
      profile: "EN16931",
      title: "RE-2026-0001",
    });
    expect(second.pdfBytes).toEqual(first.pdfBytes);
  });

  it("does not touch the base document's Info dictionary (no incidental timestamps)", async () => {
    const base = await blankBasePdf();
    const baseDoc = await PDFDocument.load(base);
    const baseInfo = baseDoc.context.lookup(baseDoc.context.trailerInfo.Info, PDFDict);

    const { pdfBytes } = await embedInvoiceInPdfA3(base, SAMPLE_XML, { profile: "EN16931" });
    const reloaded = await PDFDocument.load(pdfBytes);
    const reloadedInfo = reloaded.context.lookup(reloaded.context.trailerInfo.Info, PDFDict);

    expect(reloadedInfo.get(PDFName.CreationDate)?.toString()).toBe(
      baseInfo.get(PDFName.CreationDate)?.toString(),
    );
  });
});
