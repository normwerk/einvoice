import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { PDFDocument, PDFName, StandardFonts } from "pdf-lib";
import type { Invoice } from "@normwerk/einvoice-model";
import { checkPdfAEligibility } from "./preflight.js";
import { renderInvoicePdf } from "./render-invoice.js";

const FIXTURES_DIR = fileURLToPath(new URL("../../../fixtures", import.meta.url));

async function helveticaPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  const page = doc.addPage();
  page.drawText("Rechnung", { font: await doc.embedFont(StandardFonts.Helvetica) });
  return doc.save();
}

/** A one-page PDF whose page resources hold `font` as a direct object — no indirect reference to it. */
async function pdfWithDirectFont(font: Record<string, string>): Promise<Uint8Array> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  const page = doc.addPage();
  page.node.normalize();
  page.node.Resources()?.set(PDFName.of("Font"), doc.context.obj({ F1: doc.context.obj(font) }));
  return doc.save();
}

describe("checkPdfAEligibility (T-033)", () => {
  it("passes a PDF whose fonts are embedded — the package's own rendering", async () => {
    const invoice = JSON.parse(
      readFileSync(resolve(FIXTURES_DIR, "de-b2b-standard", "input.json"), "utf-8"),
    ) as Invoice;
    expect(await checkPdfAEligibility(await renderInvoicePdf(invoice))).toEqual({ eligible: true });
  });

  it("names a font referenced by name only — a standard font such as Helvetica", async () => {
    expect(await checkPdfAEligibility(await helveticaPdf())).toEqual({
      eligible: false,
      reason: "font-not-embedded",
      fontName: "Helvetica",
    });
  });

  it("passes a page with no fonts at all", async () => {
    const doc = await PDFDocument.create({ updateMetadata: false });
    doc.addPage();
    expect(await checkPdfAEligibility(await doc.save())).toEqual({ eligible: true });
  });

  it("finds a font written into the page's resources directly, not by reference", async () => {
    expect(
      await checkPdfAEligibility(
        await pdfWithDirectFont({ Type: "Font", Subtype: "Type1", BaseFont: "Courier" }),
      ),
    ).toEqual({ eligible: false, reason: "font-not-embedded", fontName: "Courier" });
  });

  it("calls a font without a BaseFont (unnamed)", async () => {
    expect(
      await checkPdfAEligibility(await pdfWithDirectFont({ Type: "Font", Subtype: "Type1" })),
    ).toEqual({ eligible: false, reason: "font-not-embedded", fontName: "(unnamed)" });
  });

  it("refuses an encrypted PDF", async () => {
    const doc = await PDFDocument.load(await helveticaPdf(), { updateMetadata: false });
    doc.context.trailerInfo.Encrypt = doc.context.register(
      doc.context.obj({ Filter: PDFName.of("Standard"), V: 1, R: 2, P: -4 }),
    );
    expect(await checkPdfAEligibility(await doc.save())).toEqual({
      eligible: false,
      reason: "encrypted",
    });
  });
});
