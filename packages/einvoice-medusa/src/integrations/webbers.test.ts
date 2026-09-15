import { afterEach, describe, expect, it, vi } from "vitest";
import type { MedusaContainer } from "@medusajs/framework";
import {
  fetchWebbersPdfBytes,
  waitForWebbersInvoice,
  WebbersInvoiceNotFoundError,
  WebbersNotInstalledError,
} from "./webbers.js";

describe("waitForWebbersInvoice", () => {
  it("throws WebbersNotInstalledError when @webbers/invoices-medusa isn't installed", async () => {
    // A real, true condition in this repo's own environment: @webbers/invoices-medusa is deliberately not
    // a dependency here (it's an optional peer, T-072's own doc comment) — this exercises the real import
    // failure path, not a simulated one.
    const fakeContainer = {
      resolve: () => ({ graph: async () => ({ data: [] }) }),
    } as unknown as MedusaContainer;

    await expect(
      waitForWebbersInvoice(fakeContainer, "order_1", {
        resourceId: "order_1",
        type: "debit",
        timeoutMs: 50,
        pollIntervalMs: 10,
      }),
    ).rejects.toThrow(WebbersNotInstalledError);
  });
});

describe("WebbersInvoiceNotFoundError", () => {
  it("names the order, resource, and invoice type in its message", () => {
    const error = new WebbersInvoiceNotFoundError("order_1", "ful_1", "debit");
    expect(error.orderId).toBe("order_1");
    expect(error.resourceId).toBe("ful_1");
    expect(error.type).toBe("debit");
    expect(error.message).toMatch(/order_1/);
    expect(error.message).toMatch(/ful_1/);
    expect(error.message).toMatch(/debit/);
    expect(error.name).toBe("WebbersInvoiceNotFoundError");
  });
});

describe("fetchWebbersPdfBytes", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("downloads and returns the file's bytes from the presigned URL retrieveFile hands back", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () => ({ ok: true, arrayBuffer: async () => bytes.buffer }) as unknown as Response,
      ),
    );
    const fakeContainer = {
      resolve: () => ({
        retrieveFile: async (id: string) => ({ id, url: "https://files.example.test/x.pdf" }),
      }),
    } as unknown as MedusaContainer;

    const result = await fetchWebbersPdfBytes(fakeContainer, "file_1");
    expect(Array.from(result)).toEqual([1, 2, 3, 4]);
  });

  it("throws a clear error when the download response is not ok", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 404 }) as unknown as Response),
    );
    const fakeContainer = {
      resolve: () => ({
        retrieveFile: async (id: string) => ({ id, url: "https://files.example.test/missing.pdf" }),
      }),
    } as unknown as MedusaContainer;

    await expect(fetchWebbersPdfBytes(fakeContainer, "file_missing")).rejects.toThrow(/404/);
  });
});
