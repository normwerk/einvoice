import { describe, expect, it } from "vitest";
import { parseDryRunArgs } from "./args.js";

describe("parseDryRunArgs (T-214)", () => {
  it("reads a period and the output folder", () => {
    expect(parseDryRunArgs(["from=2026-09-01", "to=2026-09-30", "out=check"])).toEqual({
      selection: { kind: "period", from: "2026-09-01", to: "2026-09-30" },
      out: "check",
    });
  });

  it("reads named orders, into the default folder", () => {
    expect(parseDryRunArgs(["orders=order_1, order_2"])).toEqual({
      selection: { kind: "orders", ids: ["order_1", "order_2"] },
      out: "einvoice-dry-run",
    });
  });

  it("refuses an unknown argument, a half period, a reversed one, and orders with a period", () => {
    expect(() => parseDryRunArgs(["--from", "2026-09-01"])).toThrow(/Unknown argument/);
    expect(() => parseDryRunArgs(["from=2026-09-01"])).toThrow(/from=YYYY-MM-DD to=YYYY-MM-DD/);
    expect(() => parseDryRunArgs(["from=2026-09-30", "to=2026-09-01"])).toThrow(/ends before/);
    expect(() => parseDryRunArgs(["orders=order_1", "from=2026-09-01"])).toThrow(/not both/);
  });
});
