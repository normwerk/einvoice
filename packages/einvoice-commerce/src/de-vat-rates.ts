/**
 * T-199 (P-73): Germany's VAT rates with the periods they apply to — a supply is taxed at the rate in force on
 * the day it is made, so an invoice reads the rate for its supply date (BT-72) rather than today's.
 *
 * Kept by hand. Every period quotes the norm it rests on word for word, and `tools/rates/verify-de-vat-rates.mjs`
 * checks each quote — with its rate and, for a temporary rate, its dates — against the UStG as the federal
 * legal information portal publishes it (`docs/sources.md`). That check fetches the text; the build does not, so
 * it stays offline and deterministic (AGENTS.md §10). The start of the 19 % period, 2007-01-01, is not in the
 * consolidated text; it is the amending law's (BGBl. I 2006 S. 1402, Art. 4).
 *
 * The EU Commission's TEDB is not a source here: asked on 2026-09-25 (`retrieveVatRates`), it gave 19 % for
 * Germany on 2020-09-01 and had no 16 % record between 2019 and 2021 at all.
 */
import type { IsoDate } from "@normwerk/einvoice-model";

/** A norm, quoted word for word as the consolidated UStG states it. */
export interface NormQuote {
  /** Which rate the quote states. */
  readonly kind: "standard" | "reduced";
  /** e.g. "§ 12 Abs. 1 UStG". */
  readonly norm: string;
  readonly text: string;
}

export interface GermanVatRatePeriod {
  /** First day the rates apply. */
  readonly from: IsoDate;
  /** Last day they apply; absent while they still do. */
  readonly to?: IsoDate;
  readonly standard: string;
  readonly reduced: string;
  readonly quotes: readonly NormQuote[];
  /** The law that set the period. */
  readonly bgbl: string;
}

const PERMANENT_QUOTES: readonly NormQuote[] = [
  {
    kind: "standard",
    norm: "§ 12 Abs. 1 UStG",
    text: "Die Steuer beträgt für jeden steuerpflichtigen Umsatz 19 Prozent der Bemessungsgrundlage",
  },
  {
    kind: "reduced",
    norm: "§ 12 Abs. 2 UStG",
    text: "Die Steuer ermäßigt sich auf sieben Prozent für die folgenden Umsätze",
  },
];

export const DE_VAT_RATE_PERIODS: readonly GermanVatRatePeriod[] = [
  {
    from: "2007-01-01",
    to: "2020-06-30",
    standard: "19",
    reduced: "7",
    quotes: PERMANENT_QUOTES,
    bgbl: "Haushaltsbegleitgesetz 2006, BGBl. I 2006 S. 1402, Art. 4",
  },
  {
    from: "2020-07-01",
    to: "2020-12-31",
    standard: "16",
    reduced: "5",
    quotes: [
      {
        kind: "standard",
        norm: "§ 28 Abs. 1 UStG",
        text:
          "§ 12 Absatz 1 ist vom 1. Juli 2020 bis 31. Dezember 2020 mit der Maßgabe anzuwenden, dass die " +
          "Steuer für jeden steuerpflichtigen Umsatz 16 Prozent der Bemessungsgrundlage",
      },
      {
        kind: "reduced",
        norm: "§ 28 Abs. 2 UStG",
        text:
          "§ 12 Absatz 2 ist vom 1. Juli 2020 bis 31. Dezember 2020 mit der Maßgabe anzuwenden, dass sich " +
          "die Steuer für die in den Nummern 1 bis 15 genannten Umsätze auf 5 Prozent ermäßigt",
      },
    ],
    bgbl: "Zweites Corona-Steuerhilfegesetz, BGBl. I 2020 S. 1512",
  },
  {
    from: "2021-01-01",
    standard: "19",
    reduced: "7",
    quotes: PERMANENT_QUOTES,
    bgbl: "§ 28 Abs. 1 and 2 UStG end on 2020-12-31 (BGBl. I 2020 S. 1512)",
  },
];

/** The first day the table covers — a supply before it is refused rather than guessed. */
export const DE_VAT_RATES_FROM: IsoDate = "2007-01-01";

/** The period in force on `date` (`YYYY-MM-DD`), or `undefined` before the table starts. */
export function germanVatRatesOn(date: IsoDate): GermanVatRatePeriod | undefined {
  return DE_VAT_RATE_PERIODS.find(
    (period) => period.from <= date && (period.to === undefined || date <= period.to),
  );
}
