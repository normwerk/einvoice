/**
 * T-214: a dry run checks each distinct VAT-ID once — VIES limits its callers, and a shop's buyers repeat — and
 * counts what came back for the report's header. Wraps the verifier the plugin is configured with.
 */
import type { VatIdEvidence, VatIdVerifier } from "@normwerk/einvoice-commerce" with {
  "resolution-mode": "import",
};
import type { DryRunScope } from "@normwerk/einvoice-conformance" with {
  "resolution-mode": "import",
};

export class CachingVatIdVerifier implements VatIdVerifier {
  private readonly answers = new Map<string, VatIdEvidence>();

  constructor(private readonly verifier: VatIdVerifier) {}

  /** The first answer for a VAT-ID, asked once. A failed check is not kept: it is asked again next time. */
  async verify(vatId: string, now: Date): Promise<VatIdEvidence> {
    const known = this.answers.get(vatId);
    if (known !== undefined) return known;
    const evidence = await this.verifier.verify(vatId, now);
    this.answers.set(vatId, evidence);
    return evidence;
  }

  counts(): DryRunScope["vatIdChecks"] {
    const statuses = [...this.answers.values()].map(({ status }) => status);
    return {
      distinct: statuses.length,
      confirmed: statuses.filter((status) => status === "valid").length,
      notConfirmed: statuses.filter((status) => status === "invalid").length,
      unavailable: statuses.filter((status) => status === "unavailable").length,
    };
  }
}
