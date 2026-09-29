/**
 * T-199/T-200: the consolidated German VAT Act (UStG) as gesetze-im-internet.de publishes it — one XML file in
 * a zip, not vendored (the site calls its texts "nicht amtlich" and grants no licence to redistribute them;
 * `docs/sources.md`). Fetched when a check runs, never at build time.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const USTG_XML_ZIP_URL = "https://www.gesetze-im-internet.de/ustg_1980/xml.zip";

/** The paragraphs Germany's VAT rates live in: § 12 (the rates) and § 28 (temporary versions of them). */
export const RATE_NORMS = ["§ 12", "§ 28"];

export function sha256(data) {
  return createHash("sha256").update(data).digest("hex");
}

/** Downloads the zip and returns the XML inside it, with the zip's hash. */
export async function fetchUstgXml(url = USTG_XML_ZIP_URL) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`GET ${url} -> ${response.status}`);
  const zip = Buffer.from(await response.arrayBuffer());
  const dir = mkdtempSync(join(tmpdir(), "ustg-"));
  const zipPath = join(dir, "xml.zip");
  writeFileSync(zipPath, zip);
  const xml = execFileSync("unzip", ["-p", zipPath, "*.xml"], {
    encoding: "utf-8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return { xml, zipSha256: sha256(zip) };
}

/** The XML of a file given on the command line (`--xml`), or the published one. */
export async function loadUstgXml(xmlPath) {
  if (xmlPath !== undefined) return { xml: readFileSync(xmlPath, "utf-8"), zipSha256: undefined };
  return fetchUstgXml();
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

/** The text of each paragraph asked for (`"§ 12"`), keyed by it; a paragraph the XML lacks is absent. */
export function extractNorms(xml, paragraphs = RATE_NORMS) {
  const texts = new Map();
  for (const norm of xml.match(/<norm[\s>][\s\S]*?<\/norm>/g) ?? []) {
    const label = /<enbez>([^<]*)<\/enbez>/.exec(norm)?.[1]?.trim();
    const text = /<textdaten>([\s\S]*)<\/textdaten>/.exec(norm)?.[1];
    if (label !== undefined && paragraphs.includes(label) && text !== undefined) {
      texts.set(label, plainText(text));
    }
  }
  return texts;
}

/** The date the XML was built, as the site states it (`builddate`, `YYYYMMDDhhmmss`). */
export function buildDate(xml) {
  return /<dokumente[^>]*\sbuilddate="(\d+)"/.exec(xml)?.[1];
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
