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

/** Compares two decimals of any scale — a VAT rate such as "5.5" or "19.000", not only a 2-decimal `Amount`. */
export function compareDecimals(a: string, b: string): -1 | 0 | 1 {
  const x = parseDecimal(a);
  const y = parseDecimal(b);
  const scale = Math.max(x.scale, y.scale);
  const diff =
    x.unscaled * 10n ** BigInt(scale - x.scale) - y.unscaled * 10n ** BigInt(scale - y.scale);
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

/**
 * P-65: splits `total` in proportion to `weights` — each share rounded down to the cent, the cents left over
 * given one each to the shares rounding cut the most (largest remainder), ties to the earlier share. The
 * shares add up to exactly `total`, in input order; a zero weight gets a zero share. Weights are
 * non-negative amounts, at least one of them non-zero.
 */
export function apportionAmount(total: string, weights: readonly string[]): string[] {
  const totalCents = toCents(total);
  const weightCents = weights.map(toCents);
  const weightSum = weightCents.reduce((sum, weight) => sum + weight, 0n);
  if (weightSum === 0n) {
    throw new Error("decimal.ts: apportionAmount needs at least one non-zero weight");
  }
  const shares = weightCents.map((weight) => ({
    cents: (totalCents * weight) / weightSum,
    remainder: (totalCents * weight) % weightSum,
  }));
  let left = totalCents - shares.reduce((sum, share) => sum + share.cents, 0n);
  const order = shares
    .map((_, index) => index)
    .sort((a, b) => {
      const [ra, rb] = [shares[a]?.remainder ?? 0n, shares[b]?.remainder ?? 0n];
      return ra > rb ? -1 : ra < rb ? 1 : a - b;
    });
  for (let k = 0; left > 0n; k++) {
    const share = shares[order[k] as number];
    if (share === undefined) break;
    share.cents += 1n;
    left -= 1n;
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
