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

/**
 * P-61: the VAT contained in a VAT-inclusive amount — `gross × percent / (100 + percent)`, rounded to 2dp
 * the way `percentOfAmount` rounds. This is how German practice states the tax of a gross price (the net
 * is the gross minus it); BR-CO-17 and BR-S-09 accept the result, which differs from `net × percent` by a
 * cent at most (both allow a difference below 1).
 */
export function vatContainedIn(grossAmount: string, percent: string): string {
  const pct = parseDecimal(percent);
  const hundred = 100n * 10n ** BigInt(pct.scale);
  const numerator = toCents(grossAmount) * pct.unscaled;
  const denominator = hundred + pct.unscaled;
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  return fromCents(remainder * 2n >= denominator ? quotient + 1n : quotient);
}

/** One VAT-inclusive part of a VAT group: a line or charge (added) or a discount (`negative`, subtracted). */
export interface VatInclusivePart {
  readonly amount: string;
  readonly negative?: boolean | undefined;
}

/**
 * P-61: the net amounts of a VAT group's VAT-inclusive parts, adding up to exactly `netTotal` (the group's
 * gross minus `vatContainedIn` it). Each part's net is its amount × 100 / (100 + percent), rounded to the
 * cent; the cents that leaves over or short go to the added parts rounding moved the most in the other
 * direction (largest remainder), ties to the earlier part. Returns non-negative nets, in input order.
 */
export function netsOfVatInclusiveParts(
  parts: readonly VatInclusivePart[],
  percent: string,
  netTotal: string,
): string[] {
  const pct = parseDecimal(percent);
  const hundred = 100n * 10n ** BigInt(pct.scale);
  const denominator = hundred + pct.unscaled;
  const shares = parts.map((part) => {
    const numerator = toCents(part.amount) * hundred;
    const quotient = numerator / denominator;
    const cents = (numerator % denominator) * 2n >= denominator ? quotient + 1n : quotient;
    // How far rounding moved the share, in 1/denominator of a cent: negative means rounded down.
    return { cents, moved: cents * denominator - numerator, negative: part.negative === true };
  });
  let residual =
    toCents(netTotal) - shares.reduce((sum, s) => sum + (s.negative ? -s.cents : s.cents), 0n);
  const added = shares.flatMap((share, index) => (share.negative ? [] : [index]));
  if (residual !== 0n && added.length === 0) {
    throw new Error("decimal.ts: netsOfVatInclusiveParts needs at least one added part");
  }
  const up = residual > 0n;
  const order = [...added].sort((a, b) => {
    const [ma, mb] = [shares[a]?.moved ?? 0n, shares[b]?.moved ?? 0n];
    const byMove = up ? (ma < mb ? -1 : ma > mb ? 1 : 0) : ma > mb ? -1 : ma < mb ? 1 : 0;
    return byMove !== 0 ? byMove : a - b;
  });
  for (let k = 0; residual !== 0n; k++) {
    const share = shares[order[k % order.length] as number];
    if (share === undefined) break;
    share.cents += up ? 1n : -1n;
    residual += up ? -1n : 1n;
  }
  return shares.map((share) => fromCents(share.cents));
}

/** P-61: a line's net unit price (BT-146) from its net amount and quantity, to 4 decimals, ties up. */
export function unitPriceOf(lineAmount: string, quantity: string): string {
  const amount = parseDecimal(lineAmount);
  const q = parseDecimal(quantity);
  if (q.unscaled === 0n) {
    throw new Error("decimal.ts: unitPriceOf needs a non-zero quantity");
  }
  const numerator = amount.unscaled * 10n ** BigInt(q.scale + 4);
  const denominator = q.unscaled * 10n ** BigInt(amount.scale);
  const quotient = numerator / denominator;
  const unscaled = (numerator % denominator) * 2n >= denominator ? quotient + 1n : quotient;
  const whole = unscaled / 10000n;
  return `${whole}.${(unscaled % 10000n).toString().padStart(4, "0")}`;
}
