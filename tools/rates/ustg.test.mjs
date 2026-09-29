import { test } from "node:test";
import assert from "node:assert/strict";
import { checkQuotes, extractNorms, germanDate, plainText } from "./ustg.mjs";
import { S12, ustgXml } from "./test-ustg-xml.mjs";

const PERIODS = [
  {
    from: "2020-07-01",
    to: "2020-12-31",
    standard: "16",
    reduced: "5",
    quotes: [
      {
        kind: "standard",
        norm: "§ 28 Abs. 1 UStG",
        text: "§ 12 Absatz 1 ist vom 1. Juli 2020 bis 31. Dezember 2020 mit der Maßgabe anzuwenden, dass die Steuer für jeden steuerpflichtigen Umsatz 16 Prozent der Bemessungsgrundlage",
      },
    ],
  },
  {
    from: "2021-01-01",
    standard: "19",
    reduced: "7",
    quotes: [
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
    ],
  },
];

test("extractNorms: the watched paragraphs' text, markup removed, whitespace collapsed", () => {
  const norms = extractNorms(ustgXml());
  assert.deepEqual([...norms.keys()], ["§ 12", "§ 28"]);
  assert.equal(norms.get("§ 12"), S12);
});

test("plainText: entities resolved, a non-breaking space read as a space", () => {
  assert.equal(plainText("<P>a &amp; b&#160;&#x2013; c</P>"), "a & b – c");
});

test("germanDate: as a statute writes it", () => {
  assert.equal(germanDate("2020-07-01"), "1. Juli 2020");
  assert.equal(germanDate("2020-12-31"), "31. Dezember 2020");
});

test("checkQuotes: every quote holds against the text it was taken from", () => {
  assert.deepEqual(checkQuotes(PERIODS, extractNorms(ustgXml())), []);
});

test("checkQuotes: a changed rate, a quote without its rate or a temporary rate without its days fails", () => {
  const raised = extractNorms(ustgXml(S12.replace("19 Prozent", "20 Prozent")));
  assert.match(
    checkQuotes(PERIODS, raised).join("\n"),
    /2021-01-01: § 12 Abs\. 1 UStG — quote not found/,
  );

  const wrongRate = [{ ...PERIODS[1], standard: "20" }];
  assert.match(
    checkQuotes(wrongRate, extractNorms(ustgXml())).join("\n"),
    /does not state the standard rate 20/,
  );

  const wrongDay = [{ ...PERIODS[0], to: "2021-06-30" }];
  assert.match(
    checkQuotes(wrongDay, extractNorms(ustgXml())).join("\n"),
    /does not state the period's day 2021-06-30/,
  );
});
