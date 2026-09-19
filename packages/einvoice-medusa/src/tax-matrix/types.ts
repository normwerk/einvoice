/**
 * T-117: the tax-scenario fixture matrix. Every cell starts at a synthetic Medusa order and goes through
 * the real, unmocked `mapOrderToCommerceInvoiceInput` (`../mapping/order-to-commerce-invoice-input.js`) —
 * the point of this suite is proving the adapter, not `@normwerk/einvoice-commerce` in isolation (that's
 * already covered by `packages/einvoice-commerce/fixtures/`, T-060/T-061).
 *
 * Both real subscribers (`../subscribers/`) call `selectProfile` before `buildInvoice`. Until **T-066**
 * fixed **P-13**, `selectProfile` rejected any non-German buyer unconditionally, which would have masked
 * P-12/P-16/P-19 on every cross-border cell if a fixture chained the two calls with early exit — the reason
 * this matrix asserts two independent axes instead. That reason still holds after the fix: a genuinely
 * unsupported or clearance-model buyer country still throws on the profile axis, and it must stay
 * distinguishable from an unrelated build-axis refusal. Each cell therefore asserts two independent axes off
 * the one real mapper output: `build` (mapper → `buildInvoice`) and `profile` (the mapper's own B2G signal →
 * `selectProfile`). Neither axis hand-builds a `CommerceInvoiceInput` — both consume the actual object the
 * real mapper produced from the actual synthetic order.
 */
import type {
  MapOrderOptions,
  MedusaOrderForInvoice,
} from "../mapping/order-to-commerce-invoice-input.js";
import type { EInvoiceProfileName, VatIdEvidence } from "@normwerk/einvoice-commerce" with {
  "resolution-mode": "import",
};
import type { VatCategoryCode } from "@normwerk/einvoice-model" with {
  "resolution-mode": "import",
};

/** One of the five bugs T-117 was written to surface, or a new finding queued alongside them
 * (`ecom docs/plan-v0.1-pending.md`) — kept as a plain string rather than a closed union so a fixture can
 * cite a freshly-queued P-number without a code change. */
export type KnownBugId = string;

export interface ErrorOutcome {
  readonly kind: "error";
  readonly errorClass: string;
  readonly messageIncludes?: string;
}

/** The mapper → `buildInvoice` axis: either a resolved VAT category or the error `buildInvoice`/
 * `decideVatCategory` threw. */
export type BuildAxisOutcome =
  { readonly kind: "ok"; readonly category: VatCategoryCode } | ErrorOutcome;

/** The mapper's B2G signal → `selectProfile` axis: either a resolved profile or the error it threw. */
export type ProfileAxisOutcome =
  { readonly kind: "ok"; readonly profile: EInvoiceProfileName } | ErrorOutcome;

/**
 * What a cell expects on each axis, written from `docs/tax-semantics.md` / `researches/08-vat-rules-de.md`
 * before the first run (T-117's own rule) — never inferred from whatever the adapter currently does.
 * `build`/`profile` always record the real, current, verified adapter output (that's what `tax-matrix
 * .test.ts` asserts against) — `specCategory`/`specRequiresRefusal` record the spec-correct answer
 * separately, even when `build`/`profile` show the adapter getting it wrong or silently succeeding at the
 * wrong thing, so a fixed bug changes the observed axis without ever touching the spec citation next to it
 * (T-133, P-28 gap 1/2: a cell that only recorded current behaviour, with no structured field marking it
 * wrong, read as if today's output were correct).
 */
export interface CellExpectation {
  /** `docs/tax-semantics.md` row this cell exercises, e.g. `"row-3"`; `undefined` for a mandatory-rejection
   * or known-gap cell with no single owning row. */
  readonly specRow?: string;
  /** The single category `docs/tax-semantics.md` says this scenario should resolve to. Set even when
   * `build` shows the adapter silently resolving to a different category (e.g. row 5/6/8 — AE/E/Z, all
   * silently misresolved to S by P-14) or refusing outright pending a blocked precondition whose eventual
   * answer is still a known, single category (row 12 — AE, blocked on M-006 artifact review, not on the
   * category itself being unclear). Mutually exclusive with `specRequiresRefusal`; both stay absent only
   * for a cell with no VAT-category dimension at all (`reject-seller-not-de`). */
  readonly specCategory?: VatCategoryCode;
  /** Set instead of `specCategory` when `docs/tax-semantics.md` itself has no single category answer for
   * this row — genuinely CONTESTED (row 13: AE / O / G, no artifact resolves it) — so the only spec-correct
   * behaviour is refusal, not a guess at which category. Never set together with `specCategory`. */
  readonly specRequiresRefusal?: true;
  readonly build: BuildAxisOutcome;
  readonly profile: ProfileAxisOutcome;
  /** Non-empty only when an axis's outcome is a known bug rather than spec-correct behaviour. */
  readonly knownBugs?: readonly KnownBugId[];
}

export interface TaxMatrixCell {
  readonly id: string;
  readonly order: MedusaOrderForInvoice;
  /** `MapOrderOptions` minus `seller`, which fixtures pull from `_shared/sellers.json` by key instead of
   * repeating the same object in every cell directory. */
  readonly mapOptions: Omit<MapOrderOptions, "seller">;
  readonly sellerKey: string;
  readonly selectProfileOptions?: { readonly preferredProfile?: EInvoiceProfileName } | undefined;
  /** T-079/P-12: the one thing `run-cell.ts` cannot get from the real mapper alone — a scripted
   * `VatIdVerifier.verify()` result, from an optional `vat-id-evidence.json` (same optional-file pattern as
   * `select-profile-options.json`). Absent for every cell that doesn't need category K reachable. */
  readonly vatIdEvidence?: VatIdEvidence | undefined;
  readonly expected: CellExpectation;
  /** Absolute path to the cell's directory, for error messages and for the Docker gate to locate the
   * scenario doc it doesn't itself parse. */
  readonly dir: string;
}
