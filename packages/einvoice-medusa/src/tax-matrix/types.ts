/**
 * T-117: the tax-scenario fixture matrix. Every cell starts at a synthetic Medusa order and goes through
 * the real, unmocked `mapOrderToCommerceInvoiceInput` (`../mapping/order-to-commerce-invoice-input.js`) —
 * the point of this suite is proving the adapter, not `@normwerk/einvoice-commerce` in isolation (that's
 * already covered by `packages/einvoice-commerce/fixtures/`, T-060/T-061).
 *
 * Both real subscribers (`../subscribers/`) call `selectProfile` before `buildInvoice`, and `selectProfile`
 * rejects any non-German buyer today (P-13) — which would mask P-12/P-16/P-19 on every cross-border cell if
 * a fixture chained the two calls with early exit. Each cell therefore asserts two independent axes off the
 * one real mapper output: `build` (mapper → `buildInvoice`) and `profile` (the mapper's own B2G signal →
 * `selectProfile`). Neither axis hand-builds a `CommerceInvoiceInput` — both consume the actual object the
 * real mapper produced from the actual synthetic order.
 */
import type {
  MapOrderOptions,
  MedusaOrderForInvoice,
} from "../mapping/order-to-commerce-invoice-input.js";
import type { EInvoiceProfileName } from "@normwerk/einvoice-commerce" with {
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
 * `specCategory` records the spec-correct answer even when `build`/`profile` show the adapter getting it
 * wrong or refusing outright; the two are deliberately kept apart so a fixed bug changes the observed axis,
 * not the spec citation.
 */
export interface CellExpectation {
  /** `docs/tax-semantics.md` row this cell exercises, e.g. `"row-3"`; `undefined` for a mandatory-rejection
   * or known-gap cell with no single owning row. */
  readonly specRow?: string;
  /** The category `docs/tax-semantics.md` says this scenario should resolve to — absent for a row that the
   * spec itself says must refuse (CONTESTED rows 12/13, `supplyType: "mixed"`). */
  readonly specCategory?: VatCategoryCode;
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
  readonly expected: CellExpectation;
  /** Absolute path to the cell's directory, for error messages and for the Docker gate to locate the
   * scenario doc it doesn't itself parse. */
  readonly dir: string;
}
