/**
 * T-074: real File Module storage for `EinvoiceDocument`'s XML/PDF content — replaces the T-071/T-072
 * stopgap (`xml` as an inline Postgres text column, `pdf` as an inline base64 text column, both flagged in
 * their own doc comments as deliberately provisional, "T-074 is the task that actually designs and wires
 * file storage") with real files: `Modules.FILE`'s own `createFiles`/`retrieveFile`, the same module
 * `integrations/webbers.ts` already reads Webbers' own PDFs through (T-072). `EinvoiceDocument` now stores
 * a file id per artifact (`xml_file_id`, `pdf_file_id`), not the content itself.
 *
 * `access: "private"` (plan-v0.1 §4.6: "хранение в File Module (private)") — an e-invoice carries the same
 * class of personal/business data (buyer name, address, in some cases a VAT-ID) a merchant would not want
 * publicly listable; `retrieveFile` still hands back a real, usable URL for a private file (confirmed
 * already in T-072 — Webbers' own PDFs are private by the File Module's own default, and
 * `fetchWebbersPdfBytes` downloads them successfully via exactly this method), so this costs nothing at
 * read time.
 */
import { Modules } from "@medusajs/framework/utils";
import type { MedusaContainer } from "@medusajs/framework";

export interface StoredEinvoiceFiles {
  readonly xmlFileId: string;
  readonly pdfFileId: string | null;
}

export interface StoreEinvoiceFilesInput {
  /** Used as the base filename for both artifacts (e.g. the document number, `"RE-2026-0003"`) — real,
   * human-meaningful filenames for whatever admin/store download names the file (`Content-Disposition`),
   * not an opaque id. */
  readonly filenamePrefix: string;
  readonly xml: string;
  /** Omitted entirely (not `undefined` vs a key with `undefined`) for a pure-XML document — mirrors
   * `basePdfBytes`'s own optionality in both subscribers (T-072/T-073), not a new convention. */
  readonly pdfBytes?: Uint8Array;
}

/**
 * Uploads the XML (always) and PDF (when present) as real, private files. Returns their ids — callers
 * store these on `EinvoiceDocument`, they do not keep the bytes around themselves once this returns.
 */
export async function storeEinvoiceFiles(
  container: MedusaContainer,
  input: StoreEinvoiceFilesInput,
): Promise<StoredEinvoiceFiles> {
  const fileModuleService = container.resolve(Modules.FILE);
  const created = await fileModuleService.createFiles(
    input.pdfBytes === undefined
      ? [
          {
            filename: `${input.filenamePrefix}.xml`,
            mimeType: "application/xml",
            content: Buffer.from(input.xml, "utf-8").toString("base64"),
            access: "private",
          },
        ]
      : [
          {
            filename: `${input.filenamePrefix}.xml`,
            mimeType: "application/xml",
            content: Buffer.from(input.xml, "utf-8").toString("base64"),
            access: "private",
          },
          {
            filename: `${input.filenamePrefix}.pdf`,
            mimeType: "application/pdf",
            content: Buffer.from(input.pdfBytes).toString("base64"),
            access: "private",
          },
        ],
  );
  const xmlFile = created[0];
  if (xmlFile === undefined) {
    throw new Error("storeEinvoiceFiles: createFiles returned no rows for the XML file.");
  }
  return {
    xmlFileId: xmlFile.id,
    pdfFileId: input.pdfBytes === undefined ? null : (created[1]?.id ?? null),
  };
}

/**
 * Best-effort cleanup for a document upload that turned out to be redundant — the real edge case
 * `recordDocumentIfAbsent`'s own doc comment already names (two literally concurrent deliveries of the
 * same event both passing the pre-check, only one winning the `UNIQUE` insert): the loser has already
 * uploaded real files for a document that will never be read, by the time it learns it lost. Swallows its
 * own failure rather than throwing — the caller's own result (the *other* delivery's document) is still
 * correct either way, and a failed cleanup here must not turn into "recordDocumentIfAbsent itself failed".
 */
export async function deleteEinvoiceFiles(
  container: MedusaContainer,
  fileIds: readonly string[],
): Promise<void> {
  if (fileIds.length === 0) {
    return;
  }
  try {
    const fileModuleService = container.resolve(Modules.FILE);
    await fileModuleService.deleteFiles([...fileIds]);
  } catch {
    // Orphaned file, not a correctness problem — see this function's own doc comment.
  }
}

/**
 * Downloads a file's bytes by id. `retrieveFile` hands back `{ id, url }` — a real, presigned download
 * URL even for a private file, not the bytes themselves — so this still needs a real `fetch()`, the same
 * two-step shape `integrations/webbers.ts`'s own `fetchWebbersPdfBytes` already established for reading
 * Webbers' own files (T-072); that function now delegates here rather than duplicating this logic for a
 * second file source.
 */
export async function fetchFileBytes(
  container: MedusaContainer,
  fileId: string,
): Promise<Uint8Array> {
  const fileModuleService = container.resolve(Modules.FILE);
  const { url } = await fileModuleService.retrieveFile(fileId);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`fetchFileBytes: downloading file ${fileId} failed (HTTP ${response.status}).`);
  }
  return new Uint8Array(await response.arrayBuffer());
}
