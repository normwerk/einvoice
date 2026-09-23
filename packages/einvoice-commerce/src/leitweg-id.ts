/**
 * T-062/W9: Leitweg-ID format validation — the German public-sector
 * (B2G) buyer-reference routing identifier that can appear in
 * `CommerceInvoiceInput.references.leitwegId`, written to BT-10.
 *
 * Real gap this closes: KoSIT's own XRechnung validator (the same Docker
 * image this repo already runs, T-040) only checks that BT-10 is
 * *present* — `BR-DE-15` ("Das Element 'Buyer reference' (BT-10) muss
 * übermittelt werden."), verified directly against the built image's own
 * rule text (`XRechnung-CII-validation.xsl`), not assumed. It performs no
 * structural or checksum check on a Leitweg-ID's own format at all — a
 * mistyped Leitweg-ID that's syntactically valid free text passes KoSIT
 * cleanly and still misroutes at the receiving public-sector mail system.
 * This is exactly the kind of gap `docs/tax-semantics.md` already
 * documents for VAT categories, applied to routing identifiers instead.
 *
 * (The todo.md task description that motivated this cited "BR-DE-16" as
 * the acceptance rule — checked against the real rule text and that's
 * wrong: BR-DE-16 is an unrelated seller-VAT-identifier rule. BR-DE-15 is
 * the real BT-10-presence rule; corrected in the private planning doc.)
 *
 * Source: the real KoSIT/xeinkauf.de specification, fetched and read
 * directly (not through a summary) —
 * https://xeinkauf.de/app/uploads/2022/11/Leitweg-ID-Formatspezifikation-v2-0-2-1.pdf
 * ("Leitweg-ID Format-Spezifikation Version 2.0.2", 28.07.2021), §2.
 * Checksum: ISO/IEC 7064:2003 MOD 97-10 (the same algorithm IBAN uses),
 * per §2.4 — computed here with `bigint`, never `Number` (a 44-digit
 * value overflows `Number`'s safe integer range).
 */

/**
 * §2.1/§2.2/§2.3/§2.5: Grobadressierung (2–12 digits, mandatory) +
 * optional "-" + Feinadressierung (1–30 alphanumeric, case-insensitive
 * Latin letters + digits) + mandatory "-" + Prüfziffer (exactly 2 digits).
 * The two length maxima (12 + 30) plus the two mandatory digits and two
 * hyphens already sum to the spec's own stated maximum of 46 — no
 * separate overall-length check is needed beyond the per-segment ones.
 */
const LEITWEG_ID_PATTERN = /^(\d{2,12})(?:-([A-Za-z0-9]{1,30}))?-(\d{2})$/;

export interface LeitwegIdValidationResult {
  readonly valid: boolean;
  /** Present only when `valid` is false. */
  readonly reason?: string;
}

/** §2.4 step 2b: A=10, B=11, … Z=35 (ISO/IEC 7064 MOD 97-10's own alphanumeric mapping — the same one IBAN uses). */
function letterToDigits(char: string): string {
  const code = char.toUpperCase().charCodeAt(0) - 55; // 'A'.charCodeAt(0) === 65; 65-55=10
  return String(code);
}

/** Converts Feinadressierung's letters to their numeric equivalents, digits pass through unchanged (§2.4 step 2). */
function numericize(segment: string): string {
  return Array.from(segment)
    .map((char) => (/[0-9]/.test(char) ? char : letterToDigits(char)))
    .join("");
}

/**
 * Full structural + checksum validation. Checksum uses the spec's own
 * "Überprüfung" method (§2.4, last paragraph): concatenate Grobadressierung
 * + numericized Feinadressierung + the given Prüfziffer digits (no
 * hyphens) and take mod 97 — a genuine Leitweg-ID's remainder is always 1.
 */
export function validateLeitwegId(value: string): LeitwegIdValidationResult {
  const match = LEITWEG_ID_PATTERN.exec(value);
  if (!match) {
    return {
      valid: false,
      reason:
        'does not match the Leitweg-ID shape: 2-12 digit Grobadressierung, optional "-" + ' +
        '1-30 alphanumeric Feinadressierung, mandatory "-" + 2-digit Prüfziffer (Format-Spezifikation §2.1)',
    };
  }
  const [, grobadressierung, feinadressierung, pruefziffer] = match;
  const digitsOnly = grobadressierung + numericize(feinadressierung ?? "") + pruefziffer;
  const remainder = BigInt(digitsOnly) % 97n;
  if (remainder !== 1n) {
    return {
      valid: false,
      reason: `checksum failed (ISO/IEC 7064 MOD 97-10, Format-Spezifikation §2.4): remainder ${remainder}, expected 1`,
    };
  }
  return { valid: true };
}

/**
 * Generates the 2-digit Prüfziffer for a Grobadressierung + Feinadressierung
 * pair (§2.4 steps 1–5) — not needed by `buildInvoice` (this package never
 * issues Leitweg-IDs, only validates ones a buyer already supplied), but
 * kept as the most direct way to test `validateLeitwegId` against the
 * spec's own worked example and to build further test vectors that are
 * internally consistent with it, not hand-typed guesses.
 */
export function computeLeitwegIdCheckDigits(
  grobadressierung: string,
  feinadressierung: string,
): string {
  const digitsOnly = grobadressierung + numericize(feinadressierung);
  const remainder = BigInt(digitsOnly + "00") % 97n;
  const checkDigits = 98n - remainder;
  return checkDigits.toString().padStart(2, "0");
}
