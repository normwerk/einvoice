/**
 * T-199/T-200/T-205: the German VAT Act (UStG) as the federal legal information portal
 * (rechtsinformationen.bund.de, run by the Federal Ministry of Justice) publishes it — each version in force
 * or enacted, as LegalDocML.de XML, through its open API. Not vendored (`docs/sources.md`): fetched when a
 * check runs, never at build time. It replaced gesetze-im-internet.de, which GitHub's runners cannot reach.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export const RIS_API = "https://testphase.rechtsinformationen.bund.de";

/** The UStG as a work — every version of it is an expression under this identifier. */
export const USTG_WORK_ELI = "eli/bund/bgbl-1/1979/s1953";

/** The paragraphs Germany's VAT rates live in: § 12 (the rates) and § 28 (temporary versions of them). */
export const RATE_NORMS = ["§ 12", "§ 28"];

export function sha256(data) {
  return createHash("sha256").update(data).digest("hex");
}

async function get(url, as) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`GET ${url} -> ${response.status}`);
  return as === "json" ? response.json() : response.text();
}

/**
 * Every version of the UStG the portal lists — the one in force and any enacted for later — each with its
 * XML. `{ eli, legalForce, xml }`, `eli` the expression's identifier.
 */
export async function fetchUstgExpressions() {
  const list = await get(`${RIS_API}/v1/legislation?eli=${USTG_WORK_ELI}&size=100`, "json");
  const expressions = [];
  for (const { item } of list.member ?? []) {
    const encoding = (item.encoding ?? []).find((e) => e.encodingFormat === "application/xml");
    if (encoding === undefined) throw new Error(`${item.legislationIdentifier}: no XML to read`);
    expressions.push({
      eli: item.legislationIdentifier,
      legalForce: item.legislationLegalForce,
      xml: await get(`${RIS_API}${encoding.contentUrl}`, "text"),
    });
  }
  if (expressions.length === 0) throw new Error(`${RIS_API} lists no version of ${USTG_WORK_ELI}`);
  return expressions;
}

/** The XML of a file given on the command line (`--xml`), or every version the portal lists. */
export async function loadUstgExpressions(xmlPath) {
  if (xmlPath !== undefined) {
    return [{ eli: xmlPath, legalForce: undefined, xml: readFileSync(xmlPath, "utf-8") }];
  }
  return fetchUstgExpressions();
}

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

/** A norm's text as a reader sees it: markup removed, entities resolved, whitespace collapsed. */
export function plainText(fragment) {
  return fragment
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&(amp|lt|gt|quot|apos);/g, (_, name) => ENTITIES[name])
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The text of each paragraph asked for (`"§ 12"`), keyed by it — without its number and heading; a paragraph
 * the XML lacks is absent. LegalDocML.de gives a paragraph as an `article`, its number in `num`.
 */
export function extractNorms(xml, paragraphs = RATE_NORMS) {
  const texts = new Map();
  for (const article of xml.match(/<(?:\w+:)?article\b[\s\S]*?<\/(?:\w+:)?article>/g) ?? []) {
    const num = /<(?:\w+:)?num\b[^>]*>([\s\S]*?)<\/(?:\w+:)?num>/.exec(article)?.[1];
    const label = num === undefined ? undefined : plainText(num);
    if (label === undefined || !paragraphs.includes(label)) continue;
    const body = article
      .replace(/^<[^>]+>/, "")
      .replace(/<(?:\w+:)?num\b[\s\S]*?<\/(?:\w+:)?num>/, "")
      .replace(/<(?:\w+:)?heading\b[\s\S]*?<\/(?:\w+:)?heading>/, "");
    texts.set(label, plainText(body));
  }
  return texts;
}

const MONTHS = [
  "Januar",
  "Februar",
  "März",
  "April",
  "Mai",
  "Juni",
  "Juli",
  "August",
  "September",
  "Oktober",
  "November",
  "Dezember",
];

/** `2020-07-01` as a German statute writes it: `1. Juli 2020`. */
export function germanDate(isoDate) {
  const [year, month, day] = isoDate.split("-").map(Number);
  return `${day}. ${MONTHS[month - 1]} ${year}`;
}

const NUMBER_WORDS = { 5: "fünf", 7: "sieben", 16: "sechzehn", 19: "neunzehn" };

/**
 * Checks every quote of every period against the norms' texts: the quote is in its paragraph word for word,
 * it states the period's rate (as a figure or a word), and a quote from § 28 — a temporary rate — states the
 * period's first and last day. Returns one line per failure; empty when every quote holds.
 */
export function checkQuotes(periods, norms) {
  const failures = [];
  for (const period of periods) {
    for (const quote of period.quotes) {
      const paragraph = /^(§ \d+[a-z]?)/.exec(quote.norm)?.[1];
      const where = `${period.from}: ${quote.norm}`;
      const text = paragraph === undefined ? undefined : norms.get(paragraph);
      if (text === undefined) {
        failures.push(`${where} — ${paragraph ?? quote.norm} not found in the UStG XML`);
        continue;
      }
      if (!text.includes(quote.text)) {
        failures.push(`${where} — quote not found word for word: "${quote.text}"`);
      }
      const rate = period[quote.kind];
      const states = [`${rate} Prozent`, `${NUMBER_WORDS[rate] ?? rate} Prozent`];
      if (!states.some((phrase) => quote.text.includes(phrase))) {
        failures.push(`${where} — quote does not state the ${quote.kind} rate ${rate} %`);
      }
      if (paragraph === "§ 28") {
        for (const day of [period.from, period.to]) {
          if (day === undefined || !quote.text.includes(germanDate(day))) {
            failures.push(`${where} — quote does not state the period's day ${day ?? "(open)"}`);
          }
        }
      }
    }
  }
  return failures;
}
