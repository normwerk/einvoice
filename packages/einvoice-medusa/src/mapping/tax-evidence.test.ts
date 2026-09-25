import { describe, expect, it } from "vitest";
import { taxEvidenceToKeep } from "./tax-evidence.js";

const SCOPE = { kind: "document" } as const;
const K = {
  ruleId: "tax-semantics#3",
  categoryCode: "K" as const,
  reasoning: "Buyer VAT-ID FR98765432109 confirmed valid by VIES.",
  scope: SCOPE,
};
const S = {
  ruleId: "tax-semantics#1",
  categoryCode: "S" as const,
  reasoning: "Domestic.",
  scope: SCOPE,
};
const EVIDENCE = {
  vatId: "FR98765432109",
  status: "valid" as const,
  checkedAt: "2026-09-25",
  consultationNumber: "WAPIAAAAW1",
};

describe("tax evidence kept with a document (T-192)", () => {
  it("keeps the VIES answer an intra-EU supply rests on, and the decision", () => {
    expect(taxEvidenceToKeep({ decisions: [K], vatIdEvidence: EVIDENCE })).toEqual({
      vatIdEvidence: EVIDENCE,
      taxDecisions: [K],
    });
  });

  it("keeps an 'unavailable' answer on a K document confirmed by other means — why they had to", () => {
    const unavailable = {
      vatId: "FR98765432109",
      status: "unavailable" as const,
      checkedAt: "2026-09-25",
    };
    expect(taxEvidenceToKeep({ decisions: [K], vatIdEvidence: unavailable }).vatIdEvidence).toEqual(
      unavailable,
    );
  });

  it("keeps no VIES answer on a document that does not rest on it — a domestic buyer with a VAT-ID", () => {
    expect(taxEvidenceToKeep({ decisions: [S], vatIdEvidence: EVIDENCE })).toEqual({
      vatIdEvidence: null,
      taxDecisions: [S],
    });
  });
});
