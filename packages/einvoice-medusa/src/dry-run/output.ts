/**
 * T-214: the dry run's output folder — `report.json`, without personal data, and `xml/<fulfillment id>.xml`
 * for each invoice the plugin would issue, which names the buyer and stays on the machine. Validating the XML
 * and rendering the report as Markdown is `@normwerk/einvoice-conformance`'s step (`dry-run <folder>`).
 *
 * A folder that already holds something other than an earlier dry run is left alone: the run replaces only its
 * own `report.json` and `xml/`.
 */
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { DryRunReport } from "@normwerk/einvoice-conformance" with {
  "resolution-mode": "import",
};

export const REPORT_FILE = "report.json";
export const XML_DIR = "xml";

/** A fulfillment id as a file name: Medusa's ids are letters, digits and underscores already. */
export function xmlFileName(fulfillmentId: string): string {
  return `${fulfillmentId.replace(/[^A-Za-z0-9_-]/g, "_")}.xml`;
}

export function writeDryRun(
  folder: string,
  report: DryRunReport,
  xml: ReadonlyMap<string, string>,
): void {
  if (
    existsSync(folder) &&
    readdirSync(folder).length > 0 &&
    !existsSync(path.join(folder, REPORT_FILE))
  ) {
    throw new Error(
      `${folder} holds files of its own, and no earlier dry run: give an empty or a new folder as out=.`,
    );
  }
  const xmlDir = path.join(folder, XML_DIR);
  rmSync(xmlDir, { recursive: true, force: true });
  mkdirSync(xmlDir, { recursive: true });
  for (const [fulfillmentId, document] of xml) {
    writeFileSync(path.join(xmlDir, xmlFileName(fulfillmentId)), document);
  }
  writeFileSync(path.join(folder, REPORT_FILE), `${JSON.stringify(report, null, 2)}\n`);
}
