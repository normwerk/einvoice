#!/usr/bin/env node
/**
 * T-030/W8: builds a PDF/A-3b ZUGFeRD/Factur-X document for every fixture
 * (serialize with einvoice-cii, embed with einvoice-pdfa) and validates it
 * for real — veraPDF (L3, PDF/A-3b conformance, via the same Docker image
 * and CLI path `pnpm conformance validate` already uses for .pdf files) and
 * Mustang (an independent Java implementation — extracts the embedded XML
 * back out byte-for-byte and separately confirms it can validate the whole
 * PDF/A+ZUGFeRD document without error, not just that the PDF/A shell is
 * valid on its own).
 *
 * The base PDF (what the invoice XML gets embedded into) is a real,
 * per-fixture visual invoice layout (`renderInvoicePdf`, render-invoice.ts)
 * with a real embedded, subset font (Liberation Sans, SIL OFL 1.1) — not a
 * blank page. That's what actually exercises the "non-embedded standard
 * font" PDF/A pitfall Spike B found (HOW-WE-GOT-HERE.md D-20): a blank page
 * sidesteps it by having no text at all, so it doesn't prove
 * `embedInvoiceInPdfA3`'s output is PDF/A-3b-valid for a real document
 * someone would actually read.
 *
 * Requires: `pnpm --filter @normwerk/einvoice-model build`,
 * `pnpm --filter @normwerk/einvoice-cii build`,
 * `pnpm --filter @normwerk/einvoice-pdfa build`, and the veraPDF + Mustang
 * Docker images built (`docker compose -f docker/compose.conformance.yml
 * build verapdf mustang`).
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../..");
const FIXTURES_DIR = resolve(REPO_ROOT, "fixtures");
const VERAPDF_IMAGE = "einvoice-conformance-verapdf:local";
const MUSTANG_IMAGE = "einvoice-conformance-mustang:local";
const PROFILES = ["XRECHNUNG", "EN16931"];

/** @returns {{ok: boolean, stdout: string}} `ok` reflects the container's real exit code — not just "did it run". */
function runDocker(image, hostDir, args, { readOnly } = { readOnly: true }) {
  const mount = readOnly ? `${hostDir}:/data:ro` : `${hostDir}:/data`;
  try {
    const stdout = execFileSync("docker", ["run", "--rm", "-v", mount, image, ...args], {
      encoding: "utf-8",
      maxBuffer: 64 * 1024 * 1024,
    });
    return { ok: true, stdout };
  } catch (error) {
    const stdout = typeof error.stdout === "string" ? error.stdout : "";
    return { ok: false, stdout: stdout + (error.stderr ?? "") };
  }
}

function validateWithVeraPdf(hostDir, fileName) {
  const { stdout } = runDocker(VERAPDF_IMAGE, hostDir, [
    "--flavour",
    "3b",
    "--format",
    "json",
    `/data/${fileName}`,
  ]);
  const jsonStart = stdout.indexOf("{");
  const report = JSON.parse(stdout.slice(jsonStart));
  const summary = report.report?.batchSummary?.validationSummary;
  const valid =
    summary !== undefined && summary.compliantPdfaCount > 0 && summary.failedJobCount === 0;
  return { valid, summary, raw: stdout };
}

function validateWithMustang(hostDir, fileName) {
  // Exit code is the real signal (same pattern as tools/conformance/roundtrip-mustang.mjs,
  // T-043) — Mustang's log lines don't contain a stable "isCompliant=..."
  // string in this CLI version; assuming one without checking would have
  // silently made every fixture "pass" regardless of the actual result.
  return runDocker(MUSTANG_IMAGE, hostDir, [
    "--action",
    "validate",
    "--source",
    `/data/${fileName}`,
  ]);
}

function extractWithMustang(hostDir, pdfFileName, outXmlFileName) {
  // --out is only documented as "optional (user will be prompted)" — in a
  // non-interactive container there is no prompt, so omitting it threw a
  // real NullPointerException (getFilenameFromUser); found by running this
  // for real, not from the --help text alone.
  const result = runDocker(
    MUSTANG_IMAGE,
    hostDir,
    ["--action", "extract", "--source", `/data/${pdfFileName}`, "--out", `/data/${outXmlFileName}`],
    { readOnly: false },
  );
  if (!result.ok) return { ok: false, xml: null, raw: result.stdout };
  try {
    return {
      ok: true,
      xml: readFileSync(resolve(hostDir, outXmlFileName), "utf-8"),
      raw: result.stdout,
    };
  } catch (error) {
    return {
      ok: false,
      xml: null,
      raw: `${result.stdout}\n(reading extracted file failed: ${error.message})`,
    };
  }
}

async function main() {
  const { serializeCii } = await import(resolve(REPO_ROOT, "packages/einvoice-cii/dist/index.js"));
  const pdfaIndexPath = resolve(REPO_ROOT, "packages/einvoice-pdfa/dist/index.js");
  const { embedInvoiceInPdfA3 } = await import(pdfaIndexPath);
  const { renderInvoicePdf } = await import(
    resolve(REPO_ROOT, "packages/einvoice-pdfa/dist/render-invoice.js")
  );

  const ids = readdirSync(FIXTURES_DIR)
    .filter((name) => {
      try {
        readFileSync(resolve(FIXTURES_DIR, name, "input.json"));
        return true;
      } catch {
        return false;
      }
    })
    .sort();

  const scratch = mkdtempSync(join(tmpdir(), "einvoice-pdfa-"));
  const results = [];

  for (const id of ids) {
    const invoice = JSON.parse(readFileSync(resolve(FIXTURES_DIR, id, "input.json"), "utf-8"));
    const { xml } = serializeCii(invoice, { profile: "en16931-cii" });
    const visualBase = await renderInvoicePdf(invoice);
    // Both ZUGFeRD profiles, not just XRECHNUNG (P-42): `selectProfile` (einvoice-commerce) picks EN16931
    // for every ordinary DE B2B invoice and every EU/CH/UK buyer, so that is the hybrid most merchants
    // actually ship — checking only XRECHNUNG left the product's most common output unvalidated.
    for (const profile of PROFILES) {
      const { pdfBytes, attachmentFilename } = await embedInvoiceInPdfA3(visualBase, xml, {
        profile,
        title: invoice.number,
      });

      const fileName = `${id}.${profile}.pdf`;
      const extractedName = `${id}.${profile}.extracted.xml`;
      writeFileSync(resolve(scratch, fileName), pdfBytes);

      const veraPdf = validateWithVeraPdf(scratch, fileName);
      const mustangValidate = validateWithMustang(scratch, fileName);
      const extraction = extractWithMustang(scratch, fileName, extractedName);
      const extractedXmlMatches = extraction.ok && extraction.xml === xml;

      results.push({
        id: `${id} [${profile}]`,
        attachmentFilename,
        veraPdfValid: veraPdf.valid,
        veraPdfSummary: veraPdf.summary,
        veraPdfRaw: veraPdf.raw,
        mustangValidateOk: mustangValidate.ok,
        mustangValidateOutput: mustangValidate.stdout,
        extractedXmlMatches,
        extractionOutput: extraction.raw,
        extractedXml: extraction.xml,
      });
    }
  }

  let allGood = true;
  for (const r of results) {
    const ok = r.veraPdfValid && r.mustangValidateOk && r.extractedXmlMatches;
    allGood &&= ok;
    console.log(`${ok ? "PASS" : "FAIL"}  ${r.id}  (attachment: ${r.attachmentFilename})`);
    if (!ok) {
      if (!r.veraPdfValid)
        console.log(
          `  veraPDF: ${JSON.stringify(r.veraPdfSummary)}\n${r.veraPdfRaw.slice(0, 2000)}`,
        );
      if (!r.mustangValidateOk)
        console.log(`  Mustang validate:\n${r.mustangValidateOutput.slice(0, 2000)}`);
      if (!r.extractedXmlMatches) {
        console.log(`  Mustang extract did not round-trip byte-for-byte.`);
        console.log(`  extract output:\n${r.extractionOutput.slice(0, 1000)}`);
        if (r.extractedXml !== null) {
          console.log(
            `  expected length ${r.extractedXml.length} vs actual — showing first divergence`,
          );
        }
      }
    }
  }
  console.log(
    `\n${results.filter((r) => r.veraPdfValid && r.mustangValidateOk && r.extractedXmlMatches).length}/${results.length} ` +
      `fixture/profile pairs produce a real veraPDF-green PDF/A-3b, a Mustang-clean validate, and byte-for-byte Mustang-extractable XML.`,
  );
  if (!allGood) process.exitCode = 1;
}

main();
