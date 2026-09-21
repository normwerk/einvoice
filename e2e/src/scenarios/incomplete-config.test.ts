import { describe, expect, it } from "vitest";
import { runMedusaOnce } from "../harness/run-medusa-once.js";

// plan-e2e.md §4: "InvalidEinvoiceModuleOptionsError при загрузке — поведение by design" — a real,
// existing guard in packages/einvoice-medusa (assertValidOptions), confirmed here against a real Medusa
// boot rather than assumed from the unit tests alone. `EINVOICE_E2E_OMIT_PAYMENT` is a stand-only knob
// (e2e/app/medusa-config.ts) that drops the plugin's required `payment` option.
describe("incomplete config: the plugin refuses to boot without required options", () => {
  it("throws InvalidEinvoiceModuleOptionsError and never starts the server", async () => {
    const result = await runMedusaOnce({ EINVOICE_E2E_OMIT_PAYMENT: "1" }, { port: 9598 });

    expect(result.exitCode).not.toBe(0);
    expect(result.output).toContain("InvalidEinvoiceModuleOptionsError");
    expect(result.output).toContain("options.payment.means is required");
    expect(result.output).not.toContain("Server is ready");
  }, 120_000);
});
