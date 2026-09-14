/**
 * T-063/W9: invoice numbering — a default, gap-free sequential strategy,
 * plus the interface an external numbering source (e.g. an existing
 * PDF-generation plugin that already numbers documents, plan-v0.1 §4.6)
 * plugs into instead.
 *
 * `NumberingStore` is the only I/O boundary (ADR-001: this package's own
 * logic stays pure) — a platform adapter backs it with its own database
 * transaction; `InMemoryNumberingStore` here is a real, usable
 * implementation for a single Node process (tests, a small standalone
 * deployment), not just a test double.
 */
import type { IsoDate } from "@normwerk/einvoice-model";

export interface NumberingStore {
  /** Atomically returns the next sequence number for `series` and persists the increment — must be
   * gap-free and duplicate-free under concurrent calls. That's the one property this interface exists to
   * guarantee. */
  allocateNext(series: string): Promise<number>;
}

export interface InvoiceNumberer {
  next(input: {
    readonly kind: "invoice" | "credit-note";
    readonly issueDate: IsoDate;
  }): Promise<string>;
}

/**
 * In-memory `NumberingStore` — safe under concurrent async calls within a single Node process because
 * JS is single-threaded and `allocateNext` does no `await` between reading and writing the counter, so no
 * other call can interleave between the two; this is a real guarantee of the runtime, not a coincidence of
 * how fast the test happens to run (the same class of assumption that turned out false for
 * `einvoice-pdfa`'s PDF timestamps, T-030 continuation — here it's actually true, and the concurrency test
 * below exists to keep proving it rather than trusting the reasoning alone).
 */
export class InMemoryNumberingStore implements NumberingStore {
  private readonly counters = new Map<string, number>();

  async allocateNext(series: string): Promise<number> {
    const next = (this.counters.get(series) ?? 0) + 1;
    this.counters.set(series, next);
    return next;
  }
}

/** Sequential, gap-free, per document-kind-and-year: `RE-2026-0001`, `GS-2026-0001` (credit notes use a
 * distinct prefix and counter series so the two never collide or interleave with each other's gaps). */
export class SequentialNumberer implements InvoiceNumberer {
  constructor(
    private readonly store: NumberingStore,
    private readonly prefixes: { readonly invoice: string; readonly creditNote: string } = {
      invoice: "RE",
      creditNote: "GS",
    },
  ) {}

  async next(input: {
    readonly kind: "invoice" | "credit-note";
    readonly issueDate: IsoDate;
  }): Promise<string> {
    const year = input.issueDate.slice(0, 4);
    const prefix = input.kind === "credit-note" ? this.prefixes.creditNote : this.prefixes.invoice;
    const seq = await this.store.allocateNext(`${input.kind}-${year}`);
    return `${prefix}-${year}-${String(seq).padStart(4, "0")}`;
  }
}
