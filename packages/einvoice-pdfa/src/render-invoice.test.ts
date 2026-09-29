import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { PDFDict, PDFDocument, PDFName, PDFRawStream, PDFRef, PDFStream } from "pdf-lib";
import type { Invoice } from "@normwerk/einvoice-model";
import { documentHeading, partyAddressLines, renderInvoicePdf } from "./render-invoice.js";

// Same fixtures/ location as einvoice-model's fixtures.test.ts and this
// package's own conformance script (tools/conformance/pdfa-embed-and-validate.mjs).
const FIXTURES_DIR = fileURLToPath(new URL("../../../fixtures", import.meta.url));

function loadFixture(id: string): Invoice {
  return JSON.parse(readFileSync(resolve(FIXTURES_DIR, id, "input.json"), "utf-8")) as Invoice;
}

const fixtureIds = readdirSync(FIXTURES_DIR)
  .filter((name) => statSync(resolve(FIXTURES_DIR, name)).isDirectory())
  .sort();

/** Finds every indirect /Type /Font dict in the document (both the composite Type0 wrapper and its CIDFontType2 descendant). */
function findFontDicts(pdfDoc: PDFDocument): PDFDict[] {
  const fonts: PDFDict[] = [];
  for (const [, object] of pdfDoc.context.enumerateIndirectObjects()) {
    if (object instanceof PDFDict) {
      const type = object.lookupMaybe(PDFName.of("Type"), PDFName);
      if (type?.asString() === "/Font") fonts.push(object);
    }
  }
  return fonts;
}

describe("renderInvoicePdf", () => {
  it("embeds a real, subset TrueType font (not one of pdf-lib's 14 standard fonts)", async () => {
    const bytes = await renderInvoicePdf(loadFixture("de-b2b-standard"));
    const reloaded = await PDFDocument.load(bytes);
    const fontDicts = findFontDicts(reloaded);
    // Type0 (composite, what fontkit-embedded TrueType fonts use) + its CIDFontType2 descendant.
    expect(fontDicts.length).toBeGreaterThanOrEqual(2);
    const type0 = fontDicts.find(
      (d) => d.lookupMaybe(PDFName.of("Subtype"), PDFName)?.asString() === "/Type0",
    );
    expect(type0).toBeDefined();
    const baseFont = type0?.lookupMaybe(PDFName.of("BaseFont"), PDFName)?.asString() ?? "";
    // pdf-lib's real subsetting convention (PDFContext.addRandomSuffix,
    // confirmed by reading its source, not assumed from the more common
    // Acrobat-style 6-uppercase-letter "+" prefix convention): fontName,
    // "-", then a random numeric suffix.
    expect(baseFont).toMatch(/^\/LiberationSans-\d+$/);

    // The actual TrueType program must be embedded (FontFile2 on the descendant's FontDescriptor) —
    // this is what makes the page PDF/A-eligible; a reference to a standard font name alone would not be.
    // Two Type0/CIDFontType2 pairs exist (Regular body text + Bold headings/totals), so match by
    // Subtype rather than "not the Type0 we already found".
    const cidFont = fontDicts.find(
      (d) => d.lookupMaybe(PDFName.of("Subtype"), PDFName)?.asString() === "/CIDFontType2",
    );
    const descriptorRef = cidFont?.get(PDFName.of("FontDescriptor"));
    const descriptor = reloaded.context.lookup(descriptorRef, PDFDict);
    const fontFile2 = descriptor.get(PDFName.of("FontFile2"));
    expect(fontFile2).toBeInstanceOf(PDFRef);
    const fontFileStream = reloaded.context.lookup(fontFile2, PDFStream);
    expect(fontFileStream).toBeInstanceOf(PDFRawStream);
  });

  it("is deterministic: rendering the same invoice twice gives byte-identical output", async () => {
    const invoice = loadFixture("de-mixed-rates");
    const first = await renderInvoicePdf(invoice);
    await new Promise((r) => setTimeout(r, 1100)); // cross a real wall-clock second boundary
    const second = await renderInvoicePdf(invoice);
    expect(second).toEqual(first);
  });

  it("renders every real fixture without throwing, as a single loadable PDF", async () => {
    for (const id of fixtureIds) {
      const invoice = loadFixture(id);
      const bytes = await renderInvoicePdf(invoice);
      const reloaded = await PDFDocument.load(bytes); // throws on a structurally invalid PDF
      expect(reloaded.getPageCount()).toBeGreaterThanOrEqual(1);
    }
  });

  it("round-trips non-ASCII text (de-special-chars) through the embedded font, not just standard WinAnsi glyphs", async () => {
    const bytes = await renderInvoicePdf(loadFixture("de-special-chars"));
    // Doesn't throw pdf-lib's "not in font" error for glyphs like ä/ß/—/½/Ø —
    // the whole point of embedding a real font via fontkit rather than a
    // WinAnsi-limited StandardFonts entry (module doc comment).
    const reloaded = await PDFDocument.load(bytes);
    expect(reloaded.getPageCount()).toBe(1);
  });

  it("prints each party's address lines above post code and city (P-60)", () => {
    expect(
      partyAddressLines({
        addressLine1: "Musterstraße 1",
        addressLine2: "Aufgang B",
        city: "Berlin",
        postCode: "10115",
        countryCode: "DE",
      }),
    ).toEqual(["Musterstraße 1", "Aufgang B", "10115 Berlin, DE"]);
    expect(partyAddressLines({ city: "Hamburg", postCode: "20095", countryCode: "DE" })).toEqual([
      "20095 Hamburg, DE",
    ]);
  });

  it("titles an invoice 'Rechnung / Invoice' and prints no reference to another invoice (T-034)", () => {
    expect(documentHeading(loadFixture("de-b2b-standard"))).toEqual({
      title: "Rechnung",
      subtitle: "Invoice",
      references: [],
    });
  });

  it("titles a credit note 'Rechnungskorrektur / Credit note', never 'Gutschrift', with the invoice it corrects (T-034)", () => {
    expect(documentHeading(loadFixture("de-credit-note"))).toEqual({
      title: "Rechnungskorrektur",
      subtitle: "Credit note",
      references: [
        "zu Rechnung RE-2026-0001 vom 2026-09-13",
        "for invoice RE-2026-0001 of 2026-09-13",
      ],
    });
  });

  it("titles a corrected invoice 'Rechnungskorrektur (berichtigt) / Corrected invoice', with the invoice it corrects (T-034)", () => {
    expect(
      documentHeading({
        typeCode: "384",
        precedingInvoiceReferences: [{ invoiceNumber: "RE-2026-0007" }],
      }),
    ).toEqual({
      title: "Rechnungskorrektur (berichtigt)",
      subtitle: "Corrected invoice",
      references: ["zu Rechnung RE-2026-0007", "for invoice RE-2026-0007"],
    });
  });

  it("refuses a document type it has no title for rather than print a wrong one (T-034)", async () => {
    await expect(
      renderInvoicePdf({ ...loadFixture("de-b2b-standard"), typeCode: "389" }),
    ).rejects.toThrow(/document type code 389/);
  });

  it("paginates onto additional pages once the line items overflow one page", async () => {
    const base = loadFixture("de-many-lines");
    const templateLine = base.lines[0];
    if (templateLine === undefined) throw new Error("de-many-lines fixture has no lines");
    const overflowLines: Invoice["lines"][number][] = [];
    for (let i = 0; i < 120; i++) {
      overflowLines.push({
        ...templateLine,
        identifier: String(i + 1),
        itemName: `Overflow test item #${i + 1}`,
      });
    }
    const manyMoreLines: Invoice = { ...base, lines: overflowLines };
    const bytes = await renderInvoicePdf(manyMoreLines);
    const reloaded = await PDFDocument.load(bytes);
    expect(reloaded.getPageCount()).toBeGreaterThan(1);
  });

  it("does not stamp a wall-clock CreationDate/ModDate (ADR-004 determinism — no Info dict at all)", async () => {
    const bytes = await renderInvoicePdf(loadFixture("de-b2b-standard"));
    const reloaded = await PDFDocument.load(bytes, { updateMetadata: false });
    const info = reloaded.context.lookup(reloaded.context.trailerInfo.Info);
    expect(info).toBeUndefined();
  });
});
