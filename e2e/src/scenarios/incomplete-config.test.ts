import { describe, expect, it } from "vitest";
import { runMedusaOnce } from "../harness/run-medusa-once.js";

// plan-e2e.md §4: "InvalidEinvoiceModuleOptionsError при загрузке — поведение by design" — a real,
// existing guard in packages/einvoice-medusa (assertValidOptions), confirmed here against a real Medusa
// boot rather than assumed from the unit tests alone. `EINVOICE_E2E_OMIT_PAYMENT` is a stand-only knob
// (e2e/app/medusa-config.ts) that drops the plugin's required `payment` option.
describe("incomplete config: the plugin refuses to boot without required options", () => {
  // P-37 (verified 2026-09-21): this is the one scenario whose own runtime (65-83s normally observed,
  // real npm install dominates it — a real, timestamped run showed only ~3s between "Running
  // migrations..." and the thrown error, so there is no earlier point in the plugin's own code to fail
  // faster at) eats most of the global 120s testTimeout, and two back-to-back full-suite runs (no pause
  // between them, the exact way CI runs) both timed out here under the ~15-20% slowdown consecutive
  // Docker teardown/boot cycles put on the whole suite. 240s is ~3x the best observed time and ~3x the
  // worst *green* observed time — margin, not a guess.
  it("throws InvalidEinvoiceModuleOptionsError and never starts the server", async () => {
    const result = await runMedusaOnce({ EINVOICE_E2E_OMIT_PAYMENT: "1" }, { port: 9598 });

    expect(result.exitCode).not.toBe(0);
    expect(result.output).toContain("InvalidEinvoiceModuleOptionsError");
    expect(result.output).toContain("options.payment.means is required");
    expect(result.output).not.toContain("Server is ready");
  }, 240_000);

  // T-077: the release checklist's own item — an unsupported seller country stops the boot with a message
  // a merchant can act on, instead of every order failing later.
  it("refuses a seller outside Germany and never starts the server", async () => {
    const result = await runMedusaOnce({ EINVOICE_E2E_SELLER_COUNTRY: "NL" }, { port: 9597 });

    expect(result.exitCode).not.toBe(0);
    expect(result.output).toContain("InvalidEinvoiceModuleOptionsError");
    expect(result.output).toContain('seller country "NL" is not supported');
    expect(result.output).toContain("(supported: DE)");
    // Where the code is explained, and where to ask for the country — no private planning references.
    expect(result.output).toContain(
      "https://normwerk.dev/einvoice/docs/errors#unsupported-seller-country",
    );
    expect(result.output).toContain("title=Support%20for%20seller%20country%20NL");
    expect(result.output).not.toMatch(/\b[TPMD]-\d{2,3}\b|STRATEGY\.md|plan-v0\.1/);
    expect(result.output).not.toContain("Server is ready");
  }, 240_000);
});
