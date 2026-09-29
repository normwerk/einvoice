import { beforeEach, describe, expect, it, vi } from "vitest";
import { describePdfNotice, documentPdf } from "./pdf.js";

// The check itself is einvoice-pdfa's (`preflight.test.ts` there, on real PDFs); this is what the plugin does
// with its answer.
const mocks = vi.hoisted(() => ({
  checkPdfAEligibility: vi.fn(),
  embedInvoiceInPdfA3: vi.fn(async () => ({
    pdfBytes: new Uint8Array([1]),
    attachmentFilename: "x",
  })),
}));
vi.mock("@normwerk/einvoice-pdfa", () => mocks);

const BASE = new Uint8Array([37, 80, 68, 70]);
const OPTIONS = { profile: "EN16931" as const, title: "RE-2026-0001" };

describe("documentPdf (T-033)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("embeds the XML into a PDF that can become PDF/A", async () => {
    mocks.checkPdfAEligibility.mockResolvedValueOnce({ eligible: true });
    expect(await documentPdf(BASE, "<xml/>", OPTIONS)).toEqual({
      pdfBytes: new Uint8Array([1]),
      pdfNotice: null,
    });
    expect(mocks.embedInvoiceInPdfA3).toHaveBeenCalledWith(BASE, "<xml/>", OPTIONS);
  });

  it("issues XML alone for a PDF with a font it does not embed, naming the font", async () => {
    mocks.checkPdfAEligibility.mockResolvedValueOnce({
      eligible: false,
      reason: "font-not-embedded",
      fontName: "Helvetica",
    });
    const { pdfBytes, pdfNotice } = await documentPdf(BASE, "<xml/>", OPTIONS);
    expect(pdfBytes).toBeUndefined();
    expect(pdfNotice).toEqual({ code: "PDF_FONT_NOT_EMBEDDED", fontName: "Helvetica" });
    expect(mocks.embedInvoiceInPdfA3).not.toHaveBeenCalled();
    expect(describePdfNotice({ code: "PDF_FONT_NOT_EMBEDDED", fontName: "Helvetica" })).toMatch(
      /^Issued as XML only: .*Helvetica without embedding it/,
    );
  });

  it("issues XML alone for an encrypted PDF", async () => {
    mocks.checkPdfAEligibility.mockResolvedValueOnce({ eligible: false, reason: "encrypted" });
    expect((await documentPdf(BASE, "<xml/>", OPTIONS)).pdfNotice).toEqual({
      code: "PDF_ENCRYPTED",
    });
  });

  it("is XML alone without a word when there is no PDF at all", async () => {
    expect(await documentPdf(undefined, "<xml/>", OPTIONS)).toEqual({
      pdfBytes: undefined,
      pdfNotice: null,
    });
    expect(mocks.checkPdfAEligibility).not.toHaveBeenCalled();
  });
});
