/**
 * A synthetic UStG XML in the shape gesetze-im-internet.de publishes, for the tests of `ustg.mjs` and
 * `watch-ustg.mjs` — two paragraphs with the wording the rate table quotes, and one it does not watch.
 */
/** The shape gesetze-im-internet.de's XML gives a norm: its number in `enbez`, its text in `textdaten`. */
export function norm(paragraph, text) {
  return (
    `<norm builddate="20260831215512"><metadaten><jurabk>UStG 1980</jurabk><enbez>${paragraph}</enbez>` +
    `</metadaten><textdaten><text format="XML"><Content><P>${text}</P></Content></text></textdaten></norm>`
  );
}

export const S12 =
  "(1) Die Steuer beträgt für jeden steuerpflichtigen Umsatz 19 Prozent der Bemessungsgrundlage " +
  "(§§ 10, 11). (2) Die Steuer ermäßigt sich auf sieben Prozent für die folgenden Umsätze: 1. …";
export const S28 =
  "(1) § 12 Absatz 1 ist vom 1. Juli 2020 bis 31. Dezember 2020 mit der Maßgabe anzuwenden, dass die Steuer " +
  "für jeden steuerpflichtigen Umsatz 16 Prozent der Bemessungsgrundlage (§§ 10, 11) beträgt. (2) § 12 " +
  "Absatz 2 ist vom 1. Juli 2020 bis 31. Dezember 2020 mit der Maßgabe anzuwenden, dass sich die Steuer für " +
  "die in den Nummern 1 bis 15 genannten Umsätze auf 5 Prozent ermäßigt.";

export function ustgXml(s12 = S12, s28 = S28) {
  return (
    `<?xml version="1.0" encoding="UTF-8" ?><dokumente builddate="20260831215512" doknr="BJNR119530979">` +
    norm("§ 12", s12) +
    norm("§ 28", s28) +
    norm("§ 29", "(1) Nicht beobachtet.") +
    "</dokumente>"
  );
}
