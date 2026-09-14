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

## Addendum (2026-09-14, T-060/W9 implementation)

Implementation added one field this ADR's original shape did not anticipate: an optional `delivery` block
(`actualDeliveryDate`, `deliverToCountryCode`, `deliverToCity`, `deliverToPostCode` — BG-13). Found by
actually running a KoSIT-validated commerce fixture for an intra-EU supply (category K, `docs/tax-semantics.md`
row 3) and getting real `BR-IC-11`/`BR-IC-12` rejections — no other category in the rule table needs
delivery info the same way (verified against the vendored Schematron, not assumed from the K case alone).
`buildInvoice` requires `actualDeliveryDate` and `deliverToCountryCode` specifically when the resolved
category is K; every other regime leaves `delivery` optional, consistent with this ADR's "mandatory only if
`buildInvoice` cannot produce a valid document without it" rule — this is that rule actually firing, not an
exception to it.

## Addendum (2026-09-14, T-060 — JSON Schema)

This ADR's own acceptance criterion named three deliverables: the ADR, the types, and a JSON Schema. The
first two closed with the W9 implementation above; the schema did not — closed now.

Generated (`packages/einvoice-commerce/src/generated/json-schema.ts`) via `ts-json-schema-generator`,
reading `types.ts`'s `CommerceInvoiceInput` (and everything it references — `CommerceParty`, `CommerceLine`,
`CommerceCharge`, `TaxContext`, `RegimeOverride`, the code-list types re-exported from
`@normwerk/einvoice-model`) directly from the TypeScript AST, run by `tools/codegen/commerce/generate-json-schema.mjs`
(`pnpm codegen:commerce`). Deliberately different from `codegen:model`'s generator: that one traces
generated code back to an external spec artifact (the vendored Schematron) because the model layer's source
of truth *is* that artifact; `CommerceInvoiceInput`'s source of truth is this ADR's own decision, already
expressed as a TypeScript type — deriving the schema from the type via a real AST-reading tool means it can
never silently drift from `types.ts`, without hand-duplicating the shape a second time the way a
hand-written JSON Schema would.

Structural-only, matching `@normwerk/einvoice-model`'s own `validateModel()` split: the schema enforces
shape (required fields, enums drawn from the same code lists the model layer uses, `additionalProperties:
false`, the `RegimeOverride` discriminated union's own per-variant requirements — e.g. `exempt` requires
`reasonText`, `zero-rated` forbids it, both already true at the TypeScript level and now enforced at
runtime too) but knows nothing about business rules or tax semantics; `decideVatCategory` and `buildInvoice`'s
own extra checks (Leitweg-ID checksum, category K's delivery requirement, XRechnung's mandatory seller
contact) still own those, layered after this structural gate, not folded into it.

Wired into `buildInvoice` itself (`packages/einvoice-commerce/src/validate.ts`,
`InvalidCommerceInvoiceInputError`) as the first check after the `schemaVersion` gate — directly serving
this ADR's own stated reason a runtime version field exists at all: "someone building `CommerceInvoiceInput`
... by hand or from a different language's tooling, without going through our `.d.ts` files at all." Before
this, such a caller's malformed payload (e.g. a currency code outside ISO 4217, confirmed via a test using
`"ZZZ"`) reached `InvalidAssembledInvoiceError` deep inside tax logic, or a raw `TypeError`, rather than a
named, listable error at the door.

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
