/**
 * A synthetic UStG XML in the shape rechtsinformationen.bund.de publishes (LegalDocML.de), for the tests of
 * `ustg.mjs` and `watch-ustg.mjs` — two paragraphs with the wording the rate table quotes, and one it does not
 * watch.
 */
/** The shape LegalDocML.de gives a paragraph: an `article`, its number in `num`, a heading, then its text. */
export function article(paragraph, heading, text) {
  const id = `art-z${paragraph.replace(/\D/g, "")}`;
  return (
    `<akn:article eId="${id}"><akn:num eId="${id}_bezeichnung-n1">${paragraph}</akn:num>` +
    `<akn:heading eId="${id}_überschrift-n1">${heading}</akn:heading><akn:paragraph eId="${id}_abs-z1">` +
    `<akn:content><akn:p>${text}<akn:marker refersTo="satzende"/></akn:p></akn:content></akn:paragraph>` +
    "</akn:article>"
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
    '<?xml version="1.0" encoding="UTF-8"?><akn:akomaNtoso xmlns:akn="http://Inhaltsdaten.LegalDocML.de/1.8.2/">' +
    "<akn:act><akn:body>" +
    article("§ 12", "Steuersätze", s12) +
    article("§ 28", "Zeitlich begrenzte Fassungen einzelner Gesetzesvorschriften", s28) +
    article("§ 29", "Umstellung langfristiger Verträge", "(1) Nicht beobachtet.") +
    "</akn:body></akn:act></akn:akomaNtoso>"
  );
}
