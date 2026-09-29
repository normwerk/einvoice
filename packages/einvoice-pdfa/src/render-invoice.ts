/**
 * T-030 continuation: a real, minimal visual layout for an `Invoice`
 * (`@normwerk/einvoice-model`), rendered with `pdf-lib` and a real embedded,
 * subset font (Liberation Sans, SIL OFL 1.1 — artifacts/fonts/, see
 * artifacts/MANIFEST.json) — not the blank-page base PDF
 * `tools/conformance/pdfa-embed-and-validate.mjs` used until now.
 *
 * This exists to close the one deliberate gap `docs/pdfa.md` documents:
 * `embedInvoiceInPdfA3` (index.ts) only adds the OutputIntent/XMP/attachment
 * machinery — it assumes its input PDF is already PDF/A-eligible. A PDF
 * using `pdf-lib`'s `StandardFonts` (or any other non-embedded font) is
 * *not* PDF/A-eligible regardless of anything `embedInvoiceInPdfA3` does
 * (Spike B, HOW-WE-GOT-HERE.md D-20) — this module is what actually makes
 * that true for a real, non-blank page, by embedding a real font instead of
 * sidestepping the problem.
 *
 * Deliberately simple: one visual style, no template system, no line
 * wrapping beyond what's needed for the fixtures this repo ships (plan-v0.1
 * §7) — this is not a general-purpose invoice designer, and none of
 * plan-v0.1's tasks ask for one. It renders every top-level BT/BG this
 * repo's `Invoice` model carries that a human reading the PDF would expect
 * to see (parties, lines, VAT breakdown, totals) — not a decorative layout.
 *
 * Fonts are embedded with `subset: true` (pdf-lib + `@pdf-lib/fontkit`):
 * PDF/A permits subsetted fonts (the common, size-conscious choice — full
 * embedding of an unused 99%+ of the glyph table isn't required by the
 * spec). pdf-lib tags the resulting `BaseFont` name as `LiberationSans-<random
 * digits>` (`PDFContext.addRandomSuffix`, confirmed by reading pdf-lib's own
 * source — not the more commonly seen Acrobat-style random-6-uppercase-
 * letters-plus-"+" convention some other tools use).
 */
import { PDFDocument, PDFFont, PDFPage, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import type { Invoice, InvoiceLine, InvoiceTypeCode } from "@normwerk/einvoice-model";
import {
  liberationSansBoldBytes,
  liberationSansRegularBytes,
} from "./generated/liberation-sans-fonts.js";

const PAGE_WIDTH = 595.28; // A4, pt
const PAGE_HEIGHT = 841.89;
const MARGIN = 50;
const CONTENT_WIDTH = PAGE_WIDTH - 2 * MARGIN;
const BODY_SIZE = 9;
const HEADING_SIZE = 16;
const LABEL_SIZE = 8;
const LINE_GAP = 13;
const BLACK = rgb(0, 0, 0);
const GREY = rgb(0.4, 0.4, 0.4);
const RULE = rgb(0.75, 0.75, 0.75);

interface Fonts {
  readonly regular: PDFFont;
  readonly bold: PDFFont;
}

/** Layout cursor: which page we're drawing on and how far down it we are. */
interface Cursor {
  page: PDFPage;
  y: number;
}

function newPage(doc: PDFDocument): PDFPage {
  return doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
}

function ensureSpace(doc: PDFDocument, cursor: Cursor, needed: number): void {
  if (cursor.y - needed < MARGIN) {
    cursor.page = newPage(doc);
    cursor.y = PAGE_HEIGHT - MARGIN;
  }
}

function text(
  cursor: Cursor,
  fonts: Fonts,
  value: string,
  x: number,
  options: { bold?: boolean; size?: number; color?: ReturnType<typeof rgb> } = {},
): void {
  cursor.page.drawText(value, {
    x,
    y: cursor.y,
    font: options.bold ? fonts.bold : fonts.regular,
    size: options.size ?? BODY_SIZE,
    color: options.color ?? BLACK,
  });
}

function line(cursor: Cursor, fromX: number, toX: number): void {
  cursor.page.drawLine({
    start: { x: fromX, y: cursor.y },
    end: { x: toX, y: cursor.y },
    thickness: 0.5,
    color: RULE,
  });
}

/** Formats an Amount (decimal string, ADR-004) for display — never round-trips through a JS number for the model value itself, only for presentation padding. */
function formatAmount(value: string | undefined): string {
  if (value === undefined) return "";
  return value;
}

/** A party's postal address as printed: its address lines (BT-35/36, BT-50/51), then post code, city and
 * country. Exported for tests — the rendered text itself is not extractable from the subset font. */
export function partyAddressLines(party: {
  readonly addressLine1?: string | undefined;
  readonly addressLine2?: string | undefined;
  readonly city: string;
  readonly postCode: string;
  readonly countryCode: string;
}): readonly string[] {
  const street = [party.addressLine1, party.addressLine2].filter(
    (line): line is string => line !== undefined && line.trim() !== "",
  );
  return [...street, `${party.postCode} ${party.city}, ${party.countryCode}`];
}

/**
 * T-034: the title by document type (BT-3), German then English, so a credit note's PDF never says "invoice"
 * while its XML says 381. A credit note is "Rechnungskorrektur", never "Gutschrift" — in UStG terms that word
 * is a self-billed invoice (§14 Abs. 2), see `docs/tax-semantics.md`. A type without a title here is refused
 * rather than printed under a wrong one.
 */
const DOCUMENT_TITLES: Partial<
  Record<InvoiceTypeCode, readonly [german: string, english: string]>
> = {
  "380": ["Rechnung", "Invoice"],
  "381": ["Rechnungskorrektur", "Credit note"],
  "384": ["Rechnungskorrektur (berichtigt)", "Corrected invoice"],
};

/** Types that correct another invoice: their PDF names it (BT-25, BT-26) under the title. */
const CORRECTING_TYPES: ReadonlySet<InvoiceTypeCode> = new Set(["381", "384"]);

export interface DocumentHeading {
  readonly title: string;
  readonly subtitle: string;
  /** For a correcting document, the invoice it corrects — a German line, then an English one. */
  readonly references: readonly string[];
}

/** The document's title and the invoice it corrects, as printed. Exported for tests — the rendered text
 * itself is not extractable from the subset font. */
export function documentHeading(
  invoice: Pick<Invoice, "typeCode" | "precedingInvoiceReferences">,
): DocumentHeading {
  const title = DOCUMENT_TITLES[invoice.typeCode];
  if (title === undefined) {
    throw new Error(
      `renderInvoicePdf has no title for document type code ${invoice.typeCode} (BT-3); ` +
        `it renders 380, 381 and 384`,
    );
  }
  const references = CORRECTING_TYPES.has(invoice.typeCode)
    ? (invoice.precedingInvoiceReferences ?? []).flatMap((reference) =>
        reference.issueDate === undefined
          ? [`zu Rechnung ${reference.invoiceNumber}`, `for invoice ${reference.invoiceNumber}`]
          : [
              `zu Rechnung ${reference.invoiceNumber} vom ${reference.issueDate}`,
              `for invoice ${reference.invoiceNumber} of ${reference.issueDate}`,
            ],
      )
    : [];
  return { title: title[0], subtitle: title[1], references };
}

function drawParty(
  cursor: Cursor,
  fonts: Fonts,
  x: number,
  heading: string,
  name: string,
  addressLines: readonly string[],
  vatIdentifier: string | undefined,
): void {
  text(cursor, fonts, heading, x, { size: LABEL_SIZE, color: GREY });
  cursor.y -= LINE_GAP;
  text(cursor, fonts, name, x, { bold: true });
  cursor.y -= LINE_GAP;
  for (const addressLine of addressLines) {
    text(cursor, fonts, addressLine, x);
    cursor.y -= LINE_GAP;
  }
  if (vatIdentifier !== undefined) {
    text(cursor, fonts, `VAT ${vatIdentifier}`, x);
    cursor.y -= LINE_GAP;
  }
}

const LINE_COLUMNS = {
  identifier: MARGIN,
  itemName: MARGIN + 30,
  quantity: MARGIN + 290,
  unitCode: MARGIN + 335,
  netPrice: MARGIN + 375,
  netAmount: MARGIN + 445,
} as const;

function drawLineItemsHeader(cursor: Cursor, fonts: Fonts): void {
  ensureSpace(cursor.page.doc, cursor, 20);
  text(cursor, fonts, "#", LINE_COLUMNS.identifier, { bold: true, size: LABEL_SIZE });
  text(cursor, fonts, "Item", LINE_COLUMNS.itemName, { bold: true, size: LABEL_SIZE });
  text(cursor, fonts, "Qty", LINE_COLUMNS.quantity, { bold: true, size: LABEL_SIZE });
  text(cursor, fonts, "Unit", LINE_COLUMNS.unitCode, { bold: true, size: LABEL_SIZE });
  text(cursor, fonts, "Price", LINE_COLUMNS.netPrice, { bold: true, size: LABEL_SIZE });
  text(cursor, fonts, "Net", LINE_COLUMNS.netAmount, { bold: true, size: LABEL_SIZE });
  cursor.y -= 4;
  line(cursor, MARGIN, MARGIN + CONTENT_WIDTH);
  cursor.y -= LINE_GAP;
}

function drawLineItem(
  doc: PDFDocument,
  cursor: Cursor,
  fonts: Fonts,
  invoiceLine: InvoiceLine,
): void {
  ensureSpace(doc, cursor, LINE_GAP + MARGIN);
  // Truncate defensively — this layout has a fixed column width and isn't a
  // general text-wrapping engine (see module doc comment).
  const itemName =
    invoiceLine.itemName.length > 45
      ? `${invoiceLine.itemName.slice(0, 44)}…`
      : invoiceLine.itemName;
  text(cursor, fonts, invoiceLine.identifier, LINE_COLUMNS.identifier);
  text(cursor, fonts, itemName, LINE_COLUMNS.itemName);
  text(cursor, fonts, formatAmount(invoiceLine.quantity), LINE_COLUMNS.quantity);
  text(cursor, fonts, invoiceLine.unitCode, LINE_COLUMNS.unitCode);
  text(cursor, fonts, formatAmount(invoiceLine.netPrice), LINE_COLUMNS.netPrice);
  text(cursor, fonts, formatAmount(invoiceLine.netAmount), LINE_COLUMNS.netAmount);
  cursor.y -= LINE_GAP;
}

function drawTotalRow(
  cursor: Cursor,
  fonts: Fonts,
  label: string,
  amount: string,
  opts: { bold?: boolean } = {},
): void {
  const labelX = MARGIN + 300;
  const amountX = MARGIN + 445;
  text(cursor, fonts, label, labelX, { bold: Boolean(opts.bold) });
  text(cursor, fonts, amount, amountX, { bold: Boolean(opts.bold) });
  cursor.y -= LINE_GAP;
}

/**
 * Renders `invoice` as a real, font-embedded A4 PDF. This is the base PDF
 * `embedInvoiceInPdfA3` (index.ts) should be given for a genuinely PDF/A-3b-
 * eligible visual invoice, in place of a blank page.
 */
export async function renderInvoicePdf(invoice: Invoice): Promise<Uint8Array> {
  // updateMetadata: false — pdf-lib's default (true) stamps CreationDate/
  // ModDate with the real wall-clock `new Date()` at construction time
  // (PDFDocument.prototype.updateInfoDict), which would make this function
  // non-deterministic (ADR-004: no Date.now()-derived output) and would
  // bake a real timestamp into the base PDF that embedInvoiceInPdfA3
  // (index.ts) then preserves rather than overwrites — found by reasoning
  // through pdf-lib's own source, not by observing a flaky test first.
  const doc = await PDFDocument.create({ updateMetadata: false });
  doc.registerFontkit(fontkit);

  const regular = await doc.embedFont(liberationSansRegularBytes(), { subset: true });
  const bold = await doc.embedFont(liberationSansBoldBytes(), { subset: true });
  const fonts: Fonts = { regular, bold };

  const cursor: Cursor = { page: newPage(doc), y: PAGE_HEIGHT - MARGIN };

  // --- Header: seller name + document title/number/date, and the invoice a correction corrects ---
  const heading = documentHeading(invoice);
  text(cursor, fonts, invoice.seller.name, MARGIN, { bold: true, size: HEADING_SIZE });
  text(cursor, fonts, heading.title, MARGIN + 300, { bold: true, size: HEADING_SIZE });
  cursor.y -= LINE_GAP + 2;
  text(cursor, fonts, heading.subtitle, MARGIN + 300, { color: GREY });
  cursor.y -= LINE_GAP + 4;
  text(cursor, fonts, `No. ${invoice.number}`, MARGIN + 300);
  cursor.y -= LINE_GAP;
  text(cursor, fonts, `Date ${invoice.issueDate}`, MARGIN + 300);
  cursor.y -= LINE_GAP;
  for (const reference of heading.references) {
    text(cursor, fonts, reference, MARGIN + 300);
    cursor.y -= LINE_GAP;
  }
  cursor.y -= LINE_GAP;

  // --- Seller / buyer party blocks, side by side ---
  const partyTopY = cursor.y;
  drawParty(
    cursor,
    fonts,
    MARGIN,
    "SELLER",
    invoice.seller.name,
    partyAddressLines(invoice.seller),
    invoice.seller.vatIdentifier,
  );
  const sellerBottomY = cursor.y;
  cursor.y = partyTopY;
  drawParty(
    cursor,
    fonts,
    MARGIN + 300,
    "BUYER",
    invoice.buyer.name,
    partyAddressLines(invoice.buyer),
    invoice.buyer.vatIdentifier,
  );
  cursor.y = Math.min(cursor.y, sellerBottomY) - LINE_GAP;

  // --- Line items ---
  drawLineItemsHeader(cursor, fonts);
  for (const invoiceLine of invoice.lines) {
    drawLineItem(doc, cursor, fonts, invoiceLine);
  }
  cursor.y -= 4;
  line(cursor, MARGIN, MARGIN + CONTENT_WIDTH);
  cursor.y -= LINE_GAP * 1.5;

  // --- VAT breakdown ---
  ensureSpace(doc, cursor, LINE_GAP * (invoice.vatBreakdown.length + 2) + MARGIN);
  text(cursor, fonts, "VAT breakdown", MARGIN, { bold: true, size: LABEL_SIZE, color: GREY });
  cursor.y -= LINE_GAP;
  for (const breakdown of invoice.vatBreakdown) {
    const rateLabel =
      breakdown.rate !== undefined ? `${breakdown.rate}%` : (breakdown.exemptionReasonCode ?? "");
    text(
      cursor,
      fonts,
      `${breakdown.categoryCode} ${rateLabel}  taxable ${formatAmount(breakdown.taxableAmount)}  tax ${formatAmount(breakdown.taxAmount)}`,
      MARGIN,
    );
    cursor.y -= LINE_GAP;
  }
  cursor.y -= LINE_GAP;

  // --- Totals ---
  const totals = invoice.totals;
  ensureSpace(doc, cursor, LINE_GAP * 8 + MARGIN);
  drawTotalRow(cursor, fonts, "Sum of line net amounts", formatAmount(totals.sumOfLineNetAmounts));
  if (totals.sumOfAllowances !== undefined) {
    drawTotalRow(cursor, fonts, "Allowances", `-${formatAmount(totals.sumOfAllowances)}`);
  }
  if (totals.sumOfCharges !== undefined) {
    drawTotalRow(cursor, fonts, "Charges", `+${formatAmount(totals.sumOfCharges)}`);
  }
  drawTotalRow(cursor, fonts, "Total without VAT", formatAmount(totals.totalAmountWithoutVat));
  if (totals.totalVatAmount !== undefined) {
    drawTotalRow(cursor, fonts, "Total VAT", formatAmount(totals.totalVatAmount));
  }
  drawTotalRow(cursor, fonts, "Total with VAT", formatAmount(totals.totalAmountWithVat), {
    bold: true,
  });
  if (totals.paidAmount !== undefined) {
    drawTotalRow(cursor, fonts, "Paid", formatAmount(totals.paidAmount));
  }
  drawTotalRow(cursor, fonts, "Amount due", formatAmount(totals.amountDueForPayment), {
    bold: true,
  });

  return doc.save();
}
