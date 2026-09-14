/**
 * T-060/W9: exact decimal arithmetic for `Amount` strings (ADR-004: amounts
 * are text, never a JS `number` — floating point would silently violate the
 * exact 2-decimal-place arithmetic `BR-CO-10`…`BR-CO-17` actually require).
 * All arithmetic here goes through `bigint`, never `Number`.
 *
 * Rounding matches the real rule text (verified against the vendored
 * Schematron, `artifacts/cii-d16b/schematron/EN16931-CII-validation-preprocessed.sch`
 * — not recalled from memory): every `BR-CO-*` sum/product is
 * `round(x * 10 * 10) div 100` — i.e. round to 2 decimal places using
 * XPath 2.0 `fn:round()`, whose own spec rounds a tie "towards positive
 * infinity". Restricted to non-negative inputs: every `Amount` this package
 * computes over is a magnitude (a price, a quantity, a rate, an allowance
 * amount) — this repo's own model represents a discount as a positive
 * `Amount` with directional meaning (allowance vs. charge), never a
 * negative number, so tie-breaking only ever needs the non-negative case.
 */

function assertNonNegative(unscaled: bigint, context: string): void {
  if (unscaled < 0n) {
    throw new Error(
      `decimal.ts: negative amount unsupported (${context}) — this package never produces one`,
    );
  }
}

function parseDecimal(value: string): { readonly unscaled: bigint; readonly scale: number } {
  if (!/^\d+(\.\d+)?$/.test(value)) {
    throw new Error(`decimal.ts: "${value}" is not a plain non-negative decimal string`);
  }
  const [intPart, fracPart = ""] = value.split(".");
  const unscaled = BigInt(intPart + fracPart);
  return { unscaled, scale: fracPart.length };
}

function fromCents(cents: bigint): string {
  assertNonNegative(cents, "fromCents");
  const wholePart = cents / 100n;
  const fracPart = (cents % 100n).toString().padStart(2, "0");
  return `${wholePart}.${fracPart}`;
}

/** Rounds `unscaled / 10^scale` to 2 decimal places, ties towards positive infinity (XPath `fn:round()`). */
function roundToAmount(unscaled: bigint, scale: number): string {
  assertNonNegative(unscaled, "roundToAmount");
  if (scale <= 2) {
    return fromCents(unscaled * 10n ** BigInt(2 - scale));
  }
  const divisor = 10n ** BigInt(scale - 2);
  const quotient = unscaled / divisor;
  const remainder = unscaled % divisor;
  const roundsUp = remainder * 2n >= divisor;
  return fromCents(roundsUp ? quotient + 1n : quotient);
}

/** `toCents`: for an `Amount` already at ≤2 decimal places (every total/allowance/charge this package sums). */
function toCents(amount: string): bigint {
  const { unscaled, scale } = parseDecimal(amount);
  if (scale > 2) {
    throw new Error(`decimal.ts: "${amount}" has more than 2 decimal places, expected an Amount`);
  }
  return unscaled * 10n ** BigInt(2 - scale);
}

export function sumAmounts(values: readonly string[]): string {
  return fromCents(values.reduce((acc, v) => acc + toCents(v), 0n));
}

export function subtractAmounts(a: string, b: string): string {
  const result = toCents(a) - toCents(b);
  assertNonNegative(result, `subtractAmounts(${a}, ${b})`);
  return fromCents(result);
}

/** Line net amount: quantity × unit price, rounded to 2dp (BR-DEC-23) — the multiplication itself is exact
 * (bigint), only the final rounding step loses precision, and only the way BR-CO-* itself rounds. */
export function multiplyToAmount(quantity: string, unitPrice: string): string {
  const q = parseDecimal(quantity);
  const p = parseDecimal(unitPrice);
  return roundToAmount(q.unscaled * p.unscaled, q.scale + p.scale);
}

/** `basisAmount × (percent / 100)`, rounded to 2dp — BR-CO-17's own formula. */
export function percentOfAmount(basisAmount: string, percent: string): string {
  const basis = parseDecimal(basisAmount);
  const pct = parseDecimal(percent);
  return roundToAmount(basis.unscaled * pct.unscaled, basis.scale + pct.scale + 2);
}

export function isZeroAmount(amount: string): boolean {
  return toCents(amount) === 0n;
}

export function compareAmounts(a: string, b: string): -1 | 0 | 1 {
  const diff = toCents(a) - toCents(b);
  if (diff === 0n) return 0;
  return diff < 0n ? -1 : 1;
}
