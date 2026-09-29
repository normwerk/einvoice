import { describe, expect, it } from "vitest";
import { DE_VAT_RATE_PERIODS, DE_VAT_RATES_FROM, germanVatRatesOn } from "./de-vat-rates.js";

const rates = (date: string) => {
  const period = germanVatRatesOn(date);
  return period === undefined ? undefined : [period.standard, period.reduced];
};

describe("Germany's VAT rates by period (T-199)", () => {
  it("gives 16 % and 5 % from 2020-07-01 to 2020-12-31, and 19 % and 7 % either side", () => {
    expect(rates("2020-06-30")).toEqual(["19", "7"]);
    expect(rates("2020-07-01")).toEqual(["16", "5"]);
    expect(rates("2020-12-31")).toEqual(["16", "5"]);
    expect(rates("2021-01-01")).toEqual(["19", "7"]);
    expect(rates("2026-09-29")).toEqual(["19", "7"]);
  });

  it("starts on 2007-01-01 and knows no rate before it", () => {
    expect(DE_VAT_RATES_FROM).toBe("2007-01-01");
    expect(rates("2007-01-01")).toEqual(["19", "7"]);
    expect(rates("2006-12-31")).toBeUndefined();
  });

  it("leaves no day uncovered and none covered twice: each period starts the day after the last ends", () => {
    const dayAfter = (date: string): string =>
      new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
    expect(DE_VAT_RATE_PERIODS[0]?.from).toBe(DE_VAT_RATES_FROM);
    DE_VAT_RATE_PERIODS.forEach((period, index) => {
      const next = DE_VAT_RATE_PERIODS[index + 1];
      if (next === undefined) {
        expect(period.to).toBeUndefined();
      } else {
        expect(period.to).toBeDefined();
        expect(next.from).toBe(dayAfter(period.to ?? ""));
      }
    });
  });

  it("quotes a norm for both rates of every period, with the BGBl reference", () => {
    for (const period of DE_VAT_RATE_PERIODS) {
      expect(period.quotes.map((quote) => quote.kind).sort()).toEqual(["reduced", "standard"]);
      expect(period.bgbl).toMatch(/BGBl\. I \d{4} S\. \d+/);
    }
  });
});
