import { describe, expect, it, vi } from "vitest";
import type { MedusaContainer } from "@medusajs/framework";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import { EINVOICE_EVENTS, emitDocumentIssued, emitIssuanceBlocked } from "./events.js";

function container(emit: ReturnType<typeof vi.fn>, warn = vi.fn()): MedusaContainer {
  const registry = new Map<unknown, unknown>([
    [Modules.EVENT_BUS, { emit }],
    [ContainerRegistrationKeys.LOGGER, { warn }],
  ]);
  return { resolve: (key: unknown) => registry.get(key) } as unknown as MedusaContainer;
}

describe("plugin events (P-71)", () => {
  it("names the issued document by id, number and what it is for — schema version 1", async () => {
    const emit = vi.fn(async () => undefined);
    await emitDocumentIssued(container(emit), {
      id: "einvdoc_1",
      order_id: "order_01",
      type: "invoice",
      document_number: "RE-2026-0001",
      fulfillment_id: "ful_01",
    });
    expect(emit).toHaveBeenCalledWith({
      name: "einvoice.document_issued",
      data: {
        schema_version: 1,
        id: "einvdoc_1",
        order_id: "order_01",
        type: "invoice",
        document_number: "RE-2026-0001",
        fulfillment_id: "ful_01",
      },
    });
  });

  it("names a refusal by id and code", async () => {
    const emit = vi.fn(async () => undefined);
    await emitIssuanceBlocked(container(emit), {
      refusal_id: "einvref_1",
      order_id: "order_01",
      type: "credit_note",
      code: "REFUND_NEEDS_MANUAL_CREDIT",
    });
    expect(emit).toHaveBeenCalledWith({
      name: EINVOICE_EVENTS.ISSUANCE_BLOCKED,
      data: {
        schema_version: 1,
        refusal_id: "einvref_1",
        order_id: "order_01",
        type: "credit_note",
        code: "REFUND_NEEDS_MANUAL_CREDIT",
      },
    });
  });

  it("logs an event it could not send, and does not fail the document already written", async () => {
    const warn = vi.fn();
    const emit = vi.fn(async () => {
      throw new Error("event bus down");
    });
    await expect(
      emitDocumentIssued(container(emit, warn), {
        id: "einvdoc_1",
        order_id: "order_01",
        type: "invoice",
        document_number: "RE-2026-0001",
      }),
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("einvoice.document_issued"));
  });
});
