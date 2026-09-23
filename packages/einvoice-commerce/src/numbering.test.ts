import { describe, expect, it } from "vitest";
import { InMemoryNumberingStore, SequentialNumberer } from "./numbering.js";

describe("SequentialNumberer", () => {
  it("formats invoice and credit-note numbers with distinct prefixes and the issue year", async () => {
    const numberer = new SequentialNumberer(new InMemoryNumberingStore());
    expect(await numberer.next({ kind: "invoice", issueDate: "2026-09-14" })).toBe("RE-2026-0001");
    expect(await numberer.next({ kind: "invoice", issueDate: "2026-09-15" })).toBe("RE-2026-0002");
    expect(await numberer.next({ kind: "credit-note", issueDate: "2026-09-16" })).toBe(
      "GS-2026-0001",
    );
  });

  it("starts a fresh, gap-free sequence for a new year without disturbing the previous year's", async () => {
    const store = new InMemoryNumberingStore();
    const numberer = new SequentialNumberer(store);
    await numberer.next({ kind: "invoice", issueDate: "2026-12-31" });
    expect(await numberer.next({ kind: "invoice", issueDate: "2027-01-01" })).toBe("RE-2027-0001");
    expect(await numberer.next({ kind: "invoice", issueDate: "2026-12-31" })).toBe("RE-2026-0002");
  });
});

describe("InMemoryNumberingStore — concurrency (T-063 acceptance: no duplicate or skipped number under concurrent calls)", () => {
  it("hands out every number from 1..N exactly once when N calls fire concurrently", async () => {
    const store = new InMemoryNumberingStore();
    const N = 500;
    const results = await Promise.all(
      Array.from({ length: N }, () => store.allocateNext("invoice-2026")),
    );
    const asSet = new Set(results);
    expect(asSet.size).toBe(N); // no duplicates
    expect(Math.min(...results)).toBe(1);
    expect(Math.max(...results)).toBe(N); // no gaps: 1..N all present, since size===N and min/max match
  });

  it("keeps separate series independent under concurrent, interleaved calls", async () => {
    const store = new InMemoryNumberingStore();
    const [invoiceNumbers, creditNoteNumbers] = await Promise.all([
      Promise.all(Array.from({ length: 100 }, () => store.allocateNext("invoice-2026"))),
      Promise.all(Array.from({ length: 100 }, () => store.allocateNext("credit-note-2026"))),
    ]);
    expect(new Set(invoiceNumbers).size).toBe(100);
    expect(new Set(creditNoteNumbers).size).toBe(100);
  });
});
