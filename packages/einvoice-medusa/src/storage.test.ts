import { afterEach, describe, expect, it, vi } from "vitest";
import type { MedusaContainer } from "@medusajs/framework";
import { deleteEinvoiceFiles, fetchFileBytes, storeEinvoiceFiles } from "./storage.js";

describe("storeEinvoiceFiles", () => {
  it("uploads only the XML file when pdfBytes is omitted", async () => {
    const createFiles = vi.fn(async (data: readonly unknown[]) =>
      data.map((_, i) => ({ id: `file_${i}`, url: `https://files.example.test/${i}` })),
    );
    const fakeContainer = { resolve: () => ({ createFiles }) } as unknown as MedusaContainer;

    const result = await storeEinvoiceFiles(fakeContainer, {
      filenamePrefix: "RE-2026-0001",
      xml: "<invoice/>",
    });

    expect(result).toEqual({ xmlFileId: "file_0", pdfFileId: null });
    expect(createFiles).toHaveBeenCalledTimes(1);
    const uploaded = createFiles.mock.calls[0]?.[0] as readonly {
      readonly filename: string;
      readonly mimeType: string;
      readonly access: string;
    }[];
    expect(uploaded).toHaveLength(1);
    expect(uploaded[0]).toMatchObject({
      filename: "RE-2026-0001.xml",
      mimeType: "application/xml",
      access: "private",
    });
  });

  it("uploads both files, in xml-then-pdf order, when pdfBytes is present", async () => {
    const createFiles = vi.fn(async (data: readonly unknown[]) =>
      data.map((_, i) => ({ id: `file_${i}`, url: `https://files.example.test/${i}` })),
    );
    const fakeContainer = { resolve: () => ({ createFiles }) } as unknown as MedusaContainer;

    const result = await storeEinvoiceFiles(fakeContainer, {
      filenamePrefix: "GS-2026-0001",
      xml: "<invoice/>",
      pdfBytes: new Uint8Array([1, 2, 3]),
    });

    expect(result).toEqual({ xmlFileId: "file_0", pdfFileId: "file_1" });
    const uploaded = createFiles.mock.calls[0]?.[0] as readonly { readonly filename: string }[];
    expect(uploaded.map((f) => f.filename)).toEqual(["GS-2026-0001.xml", "GS-2026-0001.pdf"]);
  });
});

describe("deleteEinvoiceFiles", () => {
  it("does nothing (no container resolve) for an empty list", async () => {
    const resolve = vi.fn();
    const fakeContainer = { resolve } as unknown as MedusaContainer;
    await deleteEinvoiceFiles(fakeContainer, []);
    expect(resolve).not.toHaveBeenCalled();
  });

  it("calls deleteFiles with the given ids", async () => {
    const deleteFiles = vi.fn(async () => undefined);
    const fakeContainer = { resolve: () => ({ deleteFiles }) } as unknown as MedusaContainer;
    await deleteEinvoiceFiles(fakeContainer, ["file_1", "file_2"]);
    expect(deleteFiles).toHaveBeenCalledWith(["file_1", "file_2"]);
  });

  it("swallows a deleteFiles failure rather than throwing, and logs the files no document refers to", async () => {
    const warn = vi.fn();
    const fakeContainer = {
      resolve: (key: string) =>
        key === "logger"
          ? { warn }
          : {
              deleteFiles: async () => {
                throw new Error("bucket einvoice: access denied");
              },
            },
    } as unknown as MedusaContainer;
    await expect(deleteEinvoiceFiles(fakeContainer, ["file_1", "file_2"])).resolves.toBeUndefined();
    // The files hold the buyer's details: the log says which to delete, and not the storage's own message.
    expect(warn).toHaveBeenCalledWith(
      "einvoice: files file_1, file_2 were not deleted and no document refers to them — delete them " +
        "from the File Module — an unexpected Error [INTERNAL_ERROR]",
    );
  });
});

describe("fetchFileBytes", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("downloads and returns the file's bytes from the presigned URL retrieveFile hands back", async () => {
    const bytes = new Uint8Array([9, 8, 7]);
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () => ({ ok: true, arrayBuffer: async () => bytes.buffer }) as unknown as Response,
      ),
    );
    const fakeContainer = {
      resolve: () => ({
        retrieveFile: async (id: string) => ({ id, url: "https://files.example.test/x.xml" }),
      }),
    } as unknown as MedusaContainer;

    const result = await fetchFileBytes(fakeContainer, "file_1");
    expect(Array.from(result)).toEqual([9, 8, 7]);
  });

  it("throws a clear error when the download response is not ok", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 500 }) as unknown as Response),
    );
    const fakeContainer = {
      resolve: () => ({
        retrieveFile: async (id: string) => ({ id, url: "https://files.example.test/missing.xml" }),
      }),
    } as unknown as MedusaContainer;

    await expect(fetchFileBytes(fakeContainer, "file_missing")).rejects.toThrow(/500/);
  });
});
