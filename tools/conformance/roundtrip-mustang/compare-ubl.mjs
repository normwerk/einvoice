/**
 * L5 (AGENTS.md §8): compares what Mustang read out of our CII back with the model the CII was written from.
 *
 * Mustang's `--action ubl` parses a CII document into its own Java model and writes that model out as UBL —
 * an independent implementation reading our XML, and writing what it understood. If a total, a quantity or
 * a VAT group sat in the wrong CII element, it comes back different here. Mustang writes its amounts
 * normalised ("197" for "197.00"), so amounts are compared as numbers, identifiers as text.
 *
 * Pure: UBL text and the model in, the list of compared terms out.
 */

/** @typedef {{ term: string, expected: string, actual: string | undefined, ok: boolean }} Check */

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

/** An element's text content, with the five predefined XML entities decoded. */
function text(xml, tag) {
  const match = new RegExp(`<cbc:${tag}(?:\\s[^>]*)?>([^<]*)</cbc:${tag}>`).exec(xml);
  return match?.[1].replace(/&(amp|lt|gt|quot|apos);/g, (_, name) => ENTITIES[name]);
}

function block(xml, tag) {
  const start = xml.indexOf(`<cac:${tag}>`);
  if (start < 0) return "";
  const end = xml.indexOf(`</cac:${tag}>`, start);
  return xml.slice(start, end);
}

function blocks(xml, tag) {
  return xml.match(new RegExp(`<cac:${tag}>[\\s\\S]*?</cac:${tag}>`, "g")) ?? [];
}

function sameAmount(a, b) {
  return Math.abs(Number(a) - Number(b)) < 1e-9;
}

/**
 * @param {string} ubl Mustang's UBL for one of our documents (an `Invoice` or a `CreditNote`).
 * @param {object} invoice The model the CII was serialized from (`Invoice`, `@normwerk/einvoice-model`).
 * @returns {Check[]}
 */
export function compareUblToModel(ubl, invoice) {
  /** @type {Check[]} */
  const checks = [];
  const creditNote = /<CreditNote[\s>]/.test(ubl);
  const same = (term, actual, expected) =>
    checks.push({ term, expected, actual, ok: actual === expected });
  const amount = (term, actual, expected) => {
    if (expected === undefined) return;
    // Mustang leaves out an amount that is zero; the model may carry it as "0.00".
    const value = actual ?? (sameAmount(expected, 0) ? "0" : undefined);
    checks.push({ term, expected, actual, ok: value !== undefined && sameAmount(value, expected) });
  };

  same("BT-1 invoice number", text(ubl, "ID"), invoice.number);
  same("BT-2 issue date", text(ubl, "IssueDate"), invoice.issueDate);
  same(
    "BT-3 type code",
    text(ubl, creditNote ? "CreditNoteTypeCode" : "InvoiceTypeCode"),
    invoice.typeCode,
  );
  same("BT-5 currency", text(ubl, "DocumentCurrencyCode"), invoice.currencyCode);

  const totals = block(ubl, "LegalMonetaryTotal");
  amount(
    "BT-106 sum of line net amounts",
    text(totals, "LineExtensionAmount"),
    invoice.totals.sumOfLineNetAmounts,
  );
  amount(
    "BT-107 sum of allowances",
    text(totals, "AllowanceTotalAmount"),
    invoice.totals.sumOfAllowances,
  );
  amount("BT-108 sum of charges", text(totals, "ChargeTotalAmount"), invoice.totals.sumOfCharges);
  amount(
    "BT-109 total without VAT",
    text(totals, "TaxExclusiveAmount"),
    invoice.totals.totalAmountWithoutVat,
  );
  amount(
    "BT-112 total with VAT",
    text(totals, "TaxInclusiveAmount"),
    invoice.totals.totalAmountWithVat,
  );
  amount("BT-113 paid amount", text(totals, "PrepaidAmount"), invoice.totals.paidAmount);
  amount(
    "BT-114 rounding amount",
    text(totals, "PayableRoundingAmount"),
    invoice.totals.roundingAmount,
  );
  amount("BT-115 amount due", text(totals, "PayableAmount"), invoice.totals.amountDueForPayment);

  const taxTotal = block(ubl, "TaxTotal");
  const vatTotal =
    invoice.totals.totalVatAmount ??
    String(invoice.vatBreakdown.reduce((sum, group) => sum + Number(group.taxAmount), 0));
  amount("BT-110 total VAT", text(taxTotal, "TaxAmount"), vatTotal);

  const subtotals = blocks(taxTotal, "TaxSubtotal").map((subtotal) => ({
    category: text(block(subtotal, "TaxCategory"), "ID"),
    rate: text(subtotal, "Percent") ?? "0",
    taxable: text(subtotal, "TaxableAmount"),
    tax: text(subtotal, "TaxAmount"),
  }));
  same("BG-23 VAT breakdown groups", String(subtotals.length), String(invoice.vatBreakdown.length));
  for (const group of invoice.vatBreakdown) {
    const label = `BG-23 ${group.categoryCode} ${group.rate ?? "0"}%`;
    const match = subtotals.find(
      (s) => s.category === group.categoryCode && sameAmount(s.rate, group.rate ?? "0"),
    );
    amount(`${label} taxable (BT-116)`, match?.taxable, group.taxableAmount);
    amount(`${label} VAT (BT-117)`, match?.tax, group.taxAmount);
  }

  const lines = blocks(ubl, creditNote ? "CreditNoteLine" : "InvoiceLine");
  same("BG-25 line count", String(lines.length), String(invoice.lines.length));
  invoice.lines.forEach((line, index) => {
    const ublLine = lines[index] ?? "";
    same(`line ${index + 1} BT-126 identifier`, text(ublLine, "ID"), line.identifier);
    amount(
      `line ${index + 1} BT-129 quantity`,
      text(ublLine, creditNote ? "CreditedQuantity" : "InvoicedQuantity"),
      line.quantity,
    );
    amount(
      `line ${index + 1} BT-131 net amount`,
      text(ublLine, "LineExtensionAmount"),
      line.netAmount,
    );
  });
  return checks;
}
