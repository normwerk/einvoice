/**
 * P-65 (M-039): which VAT rates a partial credit — a refund, or the rest of a cancelled invoice — reduces,
 * when the invoice it corrects has lines at more than one rate. A credit note has to state its amount per rate
 * (§14 Abs. 4 Nr. 7–8 UStG, §31 Abs. 5 UStDV), and §17 UStG corrects each rate's base by what belongs to it.
 *
 * - The money first covers goods the buyer sent back and the seller received, not credited yet, in the order
 *   they were received, up to their value, at their own rates — a refund after a return pays for that
 *   return. Nothing links a refund to a return in the platform (checked on Medusa 2.19: `refundPaymentWorkflow`
 *   records no return), so coverage is deterministic by order of receipt rather than a guess at matching
 *   amounts, which retained fees or partial refunds would break.
 * - What is left — a goodwill payment without goods, shipping paid back — reduces every rate in proportion to
 *   what is still uncredited at each rate (UStAE 10.1 Abs. 11 and 22.6 Abs. 20–21 by analogy: split in
 *   proportion to the supplies), the cents left over by largest remainder.
 *
 * Amounts are gross (VAT included): what was paid back, and what the invoice charged per rate. Pure; the
 * caller supplies the returns and what earlier credit notes already covered.
 */
import {
  apportionAmount,
  compareAmounts,
  isZeroAmount,
  subtractAmounts,
  sumAmounts,
} from "./decimal.js";
import type { Amount } from "@normwerk/einvoice-model";

/** A gross amount at one VAT rate. */
export interface AmountAtRate {
  readonly rate: Amount;
  readonly gross: Amount;
}

/** A received return of goods, with the value still to credit at each rate. */
export interface ReturnToCredit {
  readonly id: string;
  readonly byRate: readonly AmountAtRate[];
}

export interface CreditAllocationInput {
  /** The gross amount to credit. At most what `uncreditedByRate` adds up to. */
  readonly amount: Amount;
  /** Received returns, in the order they were received. */
  readonly returns: readonly ReturnToCredit[];
  /** Per rate, the invoice's gross amount less what earlier credit notes credited at that rate. */
  readonly uncreditedByRate: readonly AmountAtRate[];
}

/** One part of the credit: at a rate, and — when it pays for a return — which return. */
export interface CreditPiece extends AmountAtRate {
  readonly returnId?: string | undefined;
}

export class CreditExceedsInvoiceError extends Error {
  constructor(
    readonly amount: Amount,
    readonly uncredited: Amount,
  ) {
    super(
      `A credit of ${amount} exceeds the ${uncredited} still uncredited on the invoice — refusing to ` +
        "credit more than was invoiced.",
    );
    this.name = "CreditExceedsInvoiceError";
  }
}

function minAmount(a: Amount, b: Amount): Amount {
  return compareAmounts(a, b) <= 0 ? a : b;
}

export function allocateCreditAcrossRates(input: CreditAllocationInput): readonly CreditPiece[] {
  const available = new Map<string, Amount>(
    input.uncreditedByRate.map((entry) => [entry.rate, entry.gross]),
  );
  const uncredited = sumAmounts([...available.values()]);
  if (compareAmounts(input.amount, uncredited) > 0) {
    throw new CreditExceedsInvoiceError(input.amount, uncredited);
  }
  const pieces: CreditPiece[] = [];
  const take = (rate: Amount, gross: Amount, returnId?: string): void => {
    if (isZeroAmount(gross)) return;
    pieces.push(returnId === undefined ? { rate, gross } : { rate, gross, returnId });
    available.set(rate, subtractAmounts(available.get(rate) ?? "0.00", gross));
  };

  let remaining = input.amount;
  for (const received of input.returns) {
    if (isZeroAmount(remaining)) break;
    // Never more at a rate than the invoice still has uncredited there.
    const capped = received.byRate.map((entry) => ({
      rate: entry.rate,
      gross: minAmount(entry.gross, available.get(entry.rate) ?? "0.00"),
    }));
    const value = sumAmounts(capped.map((entry) => entry.gross));
    if (isZeroAmount(value)) continue;
    const covered = minAmount(remaining, value);
    const shares =
      compareAmounts(covered, value) === 0
        ? capped.map((entry) => entry.gross)
        : apportionAmount(
            covered,
            capped.map((entry) => entry.gross),
          );
    capped.forEach((entry, index) => take(entry.rate, shares[index] as Amount, received.id));
    remaining = subtractAmounts(remaining, covered);
  }

  if (!isZeroAmount(remaining)) {
    const rates = [...available.keys()];
    const shares = apportionAmount(
      remaining,
      rates.map((rate) => available.get(rate) ?? "0.00"),
    );
    rates.forEach((rate, index) => take(rate, shares[index] as Amount));
  }
  return pieces;
}
