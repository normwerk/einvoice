/**
 * T-063/W9: invoice numbering — a default sequential strategy, plus the
 * interface an external numbering source (e.g. an existing PDF-generation
 * plugin that already numbers documents, plan-v0.1 §4.6) plugs into instead.
 *
 * What the law requires is a unique number (§14 Abs. 4 Satz 1 Nr. 4 UStG);
 * a series without gaps is not required (UStAE 14.5 Abs. 10). A number is
 * taken before the document is stored, so a failure in between (a file
 * upload, say) leaves a gap — never a duplicate.
 *
 * `NumberingStore` is the only I/O boundary (ADR-001: this package's own
 * logic stays pure) — a platform adapter backs it with its own database
 * transaction. `InMemoryNumberingStore` is for tests only (P-48): it forgets
 * its counters on restart.
 */
import type { IsoDate } from "@normwerk/einvoice-model";

export interface NumberingStore {
  /** Atomically returns the next sequence number for `series` and persists the increment — must never
   * return the same number twice, under concurrent calls and across restarts. That's the one property this
   * interface exists to guarantee. */
  allocateNext(series: string): Promise<number>;
}

export interface InvoiceNumberer {
  next(input: {
    readonly kind: "invoice" | "credit-note";
    readonly issueDate: IsoDate;
  }): Promise<string>;
}

/**
 * In-memory `NumberingStore`, **for tests only**: its counters live in memory, so after a restart every
 * series starts again at 1 and repeats numbers already issued — which §14 Abs. 4 Satz 1 Nr. 4 UStG forbids.
 * A production store keeps its counters in durable storage (the Medusa plugin: its own database table).
 *
 * Safe under concurrent async calls within a single Node process because
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

/** Sequential per document kind and year: `RE-2026-0001`, `GS-2026-0001` (credit notes use a
 * distinct prefix and counter series so the two never collide). */
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
