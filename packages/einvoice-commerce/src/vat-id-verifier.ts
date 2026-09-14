/**
 * T-061/D-19: `VatIdVerifier` mock implementations for tests and for a
 * caller who hasn't wired a real VIES-backed one yet. A real VIES
 * reference implementation is deferred to v0.2 (plan-v0.1 §9 W9's own
 * pre-approved contingency — see types.ts's `VatIdVerifier` doc comment);
 * nothing here makes a network call.
 */
import type { VatIdEvidence, VatIdVerifier } from "./types.js";

/** Always returns the same status for every VAT-ID — the simplest mock, for a test that only cares about one outcome. */
export class StaticVatIdVerifier implements VatIdVerifier {
  constructor(
    private readonly status: VatIdEvidence["status"],
    private readonly consultationNumber?: string,
  ) {}

  async verify(vatId: string, now: Date): Promise<VatIdEvidence> {
    return {
      vatId,
      status: this.status,
      checkedAt: now.toISOString().slice(0, 10),
      consultationNumber: this.status === "unavailable" ? undefined : this.consultationNumber,
    };
  }
}

/** Per-VAT-ID scripted responses — for a test exercising more than one buyer/outcome at once. Throws for an
 * unscripted VAT-ID rather than silently defaulting, so a forgotten fixture fails loudly, not quietly. */
export class MapVatIdVerifier implements VatIdVerifier {
  constructor(private readonly responses: ReadonlyMap<string, VatIdEvidence["status"]>) {}

  async verify(vatId: string, now: Date): Promise<VatIdEvidence> {
    const status = this.responses.get(vatId);
    if (status === undefined) {
      throw new Error(`MapVatIdVerifier: no scripted response for VAT-ID "${vatId}"`);
    }
    return {
      vatId,
      status,
      checkedAt: now.toISOString().slice(0, 10),
      consultationNumber: status === "unavailable" ? undefined : `MOCK-${vatId}`,
    };
  }
}
