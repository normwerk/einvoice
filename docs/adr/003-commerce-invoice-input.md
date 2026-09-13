# ADR-003: `CommerceInvoiceInput` contract

**Status:** Accepted — 2026-09-13. Written ahead of its implementation (the adapter-facing task is later,
W9) because Sprint 0 closes out the core ADRs on paper first — the same reasoning as drafting the tax rules
table (`docs/tax-semantics.md`) before any commerce code exists.

## Context

`einvoice-commerce` is platform-agnostic by rule (`AGENTS.md` §6): no Medusa or Vendure type may appear in
it, ever. Every adapter (`einvoice-medusa` today, a Vendure one later, conceivably a hand-built one from
outside this repo) maps its own platform's order/refund shape into one common input type. That type's
shape — and how it can change without breaking an adapter someone else wrote — is what this ADR fixes.

## Decision

**Shape.** `CommerceInvoiceInput` is a plain, JSON-serializable object:

```ts
export interface CommerceInvoiceInput {
  readonly schemaVersion: 1;
  readonly document: {
    readonly kind: "invoice" | "credit-note";
    readonly number?: string; // omit if an external plugin numbers the document
    readonly issueDate: IsoDate;
    readonly currency: CurrencyCode;
    readonly correctedInvoice?: { readonly number: string; readonly issueDate: IsoDate }; // BT-25/26
  };
  readonly seller: CommerceParty;
  readonly buyer: CommerceParty;
  readonly lines: readonly CommerceLine[];
  readonly shipping?: CommerceCharge;
  readonly discounts?: readonly CommerceCharge[];
  readonly payment?: {
    readonly means?: PaymentMeansCode;
    readonly terms?: string;
    readonly iban?: string;
  };
  readonly references?: {
    readonly buyerReference?: string; // BT-10 / Leitweg-ID
    readonly orderReference?: string; // BT-13
    readonly contractReference?: string; // BT-12
  };
  readonly taxContext: TaxContext;
}
```

(`CommerceParty`, `CommerceLine`, `CommerceCharge`, `TaxContext` as drafted in plan-v0.1 §4.4 — reproduced
in the package's own types when T-060 implements this, not duplicated here.)

**Mandatory vs. optional** follows one rule: a field is mandatory if `einvoice-commerce` cannot compute a
correct `TaxDecision` or a valid EN 16931 document without it (`document`, `seller`, `buyer`, `lines`,
`taxContext`); everything else — an external plugin's own numbering, shipping, discounts, payment detail,
free-text references — is optional because a valid invoice can exist without it, or a specific adapter mode
(standalone vs. on top of a PDF plugin, plan-v0.1 §4.6) legitimately won't have it.

**`taxContext` is supplied, not derived.** Whoever builds `CommerceInvoiceInput` (an adapter, or a
hand-written integration) states the seller/buyer VAT registration facts honestly; `einvoice-commerce`
decides the VAT category _from_ those facts (that decision is the whole value of the package) but does not
go verify a VAT-ID against VIES itself — no such requirement exists in the v0.1 scope, and doing so would
be an I/O side effect this pure layer (ADR-001) doesn't have.

**Versioning: an explicit `schemaVersion` field.** `buildInvoice()` checks it first and throws a specific,
named error for a version it doesn't support, rather than failing on an unrelated missing-field error deep
inside tax logic. This costs one mandatory field and one runtime check. The alternative — relying on the
npm package's own semver and TypeScript types alone — is invisible to exactly the audience this project is
trying to attract as a demand probe: someone building their own adapter (a Vendure integration, an
in-house one) who may construct the object by hand or from a different language's tooling, without going
through our `.d.ts` files at all. `schemaVersion` gives that caller a self-describing contract and this
package a clear, early failure instead of a confusing one.

Bump `schemaVersion` only for a breaking change to the shape (removing a field, changing what a field
means, tightening a previously-optional field to required). Adding a new optional field is not a breaking
change and does not need a bump.

## Consequences

- Every `CommerceInvoiceInput` fixture and every adapter must set `schemaVersion: 1` — TypeScript enforces
  this for our own code; the runtime check in `buildInvoice()` catches everyone else.
- A future breaking change to the contract means introducing `schemaVersion: 2` and (per how the codebase
  already treats such changes, `AGENTS.md` §9's spirit) explicitly deciding whether `buildInvoice()`
  supports both versions for a deprecation window or only the latest — that decision is deferred to
  whenever it's actually needed, not pre-answered here.

## Alternatives considered

- **npm semver only, no runtime field** — rejected: invisible to a hand-built or non-TypeScript payload,
  which is precisely the case a demand-probe project should expect and support gracefully rather than fail
  confusingly on.
- **A TypeScript discriminated union type name as the only version marker** (e.g. `CommerceInvoiceInputV1`,
  no runtime field) — rejected for the same reason: compile-time safety for our own code, nothing for
  anyone else's.
- **Typed, per-scheme identifier fields** (e.g. a `LeitwegId` branded type) instead of plain strings under
  `references` — rejected for v0.1: the commerce layer is what knows which scheme a given buyer/profile
  requires (that's exactly the kind of judgment call `docs/tax-semantics.md` flags as not obvious from the
  wire format alone); typing it at the input boundary would just move that judgment to callers who have
  less context than `einvoice-commerce` does.
