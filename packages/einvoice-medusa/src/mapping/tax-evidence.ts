/**
 * T-192: what a document keeps of the tax decision it was built on. The exemption of an intra-EU supply
 * (category K) rests on the buyer's VAT-ID being valid on the day of supply (§6a Abs. 1 Nr. 4 UStG), and the
 * seller has to show that in an audit — so the VIES answer the decision was made on is kept with the document
 * that relies on it, and with no other: a domestic order whose buyer also has a VAT-ID does not need it. The
 * answer is what the merchant's own `vatIdVerifier` returned: the VAT-ID (already on the document, BT-48), the
 * status, the date and VIES's consultation number — no name or address. Kept even when it says "unavailable"
 * and the merchant confirmed the number by other means: that is the record of why they had to.
 *
 * Every document keeps its decisions — the rule of `docs/tax-semantics.md` it followed, the category and the
 * reasoning.
 */
import type { BuildResult, TaxDecision, VatIdEvidence } from "@normwerk/einvoice-commerce" with {
  "resolution-mode": "import",
};

export interface KeptTaxEvidence {
  readonly vatIdEvidence: VatIdEvidence | null;
  readonly taxDecisions: readonly TaxDecision[];
}

export function taxEvidenceToKeep(
  result: Pick<BuildResult, "decisions" | "vatIdEvidence">,
): KeptTaxEvidence {
  const restsOnVatId = result.decisions.some((decision) => decision.categoryCode === "K");
  return {
    vatIdEvidence: restsOnVatId ? (result.vatIdEvidence ?? null) : null,
    taxDecisions: result.decisions,
  };
}
