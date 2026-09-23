/**
 * Drives one `TaxMatrixCell` through the real adapter functions. See `types.ts`'s doc comment for why this
 * checks two independent axes off one real mapper output instead of chaining `selectProfile` →
 * `buildInvoice` with early exit the way the production subscribers do.
 *
 * `selectProfile`/`buildInvoice` are passed in rather than imported here so the same logic runs both under
 * vitest (static imports — safe there, unlike in the shipped plugin, see `order-to-commerce-invoice-input
 * .ts`'s own doc comment on the CJS/ESM split) and under the Docker gate
 * (`tools/conformance/run-tax-matrix.mjs`, dynamic `import()` against the same real package builds).
 */
import type {
  BuildInvoiceOptions,
  BuildResult,
  CommerceInvoiceInput,
  EInvoiceProfileName,
  SelectProfileOptions,
} from "@normwerk/einvoice-commerce" with { "resolution-mode": "import" };
import { mapOrderToCommerceInvoiceInput } from "../mapping/order-to-commerce-invoice-input.js";
import { loadSellers } from "./load-cells.js";
import type { BuildAxisOutcome, ProfileAxisOutcome, TaxMatrixCell } from "./types.js";

export interface TaxMatrixDeps {
  readonly selectProfile: (options: SelectProfileOptions) => EInvoiceProfileName;
  readonly buildInvoice: (
    input: CommerceInvoiceInput,
    options?: BuildInvoiceOptions,
  ) => BuildResult;
}

export interface CellRunResult {
  readonly input: CommerceInvoiceInput;
  readonly build: BuildAxisOutcome;
  /** Only set when `build.kind === "ok"` — the full `buildInvoice` result, so a caller that needs to
   * serialize it (the Docker conformance gate) doesn't have to call `buildInvoice` a second time. */
  readonly buildResult: BuildResult | undefined;
  readonly profile: ProfileAxisOutcome;
}

function errorOf(error: unknown): { errorClass: string; messageIncludes: string } {
  if (error instanceof Error) {
    return { errorClass: error.name, messageIncludes: error.message };
  }
  return { errorClass: "UnknownError", messageIncludes: String(error) };
}

/** Same seller record the real subscribers thread through `MapOrderOptions.seller` — kept out of each
 * fixture's `map-options.json` (`_shared/sellers.json`, keyed by `sellerKey`) so 30+ cells don't repeat the
 * same object. */
function resolveSeller(cell: TaxMatrixCell): CommerceInvoiceInput["seller"] {
  const sellers = loadSellers();
  const seller = sellers[cell.sellerKey];
  if (seller === undefined) {
    throw new Error(`tax-matrix cell "${cell.id}": unknown sellerKey "${cell.sellerKey}"`);
  }
  return seller;
}

export function runTaxMatrixCell(cell: TaxMatrixCell, deps: TaxMatrixDeps): CellRunResult {
  const seller = resolveSeller(cell);
  // Mapping itself is never expected to throw for a well-formed matrix cell — a `MissingBuyerCountryError`
  // here would mean the fixture's own `order.json` is malformed, not a tax-scenario finding, so it is
  // deliberately not caught: a broken fixture should fail loudly, not be silently recorded as a "bug".
  const mapped = mapOrderToCommerceInvoiceInput(cell.order, { ...cell.mapOptions, seller });
  // `mapOrderToCommerceInvoiceInput` deliberately never sets `document.number` (its own doc comment:
  // numbering is I/O, ADR-001) — the real subscribers allocate one via `SequentialNumberer`/a Postgres-backed
  // `NumberingStore` before calling `buildInvoice`. That allocation is orthogonal to tax-category logic (no
  // branch in `decideVatCategory` reads it), so this harness stands in with a deterministic, fixture-derived
  // number rather than pulling in the real numbering I/O stack — `MissingDocumentNumberError` would otherwise
  // fire on every single cell for a reason that has nothing to do with what the matrix is testing.
  const input = {
    ...mapped,
    document: { ...mapped.document, number: `TEST-${cell.id}` },
  };

  let build: BuildAxisOutcome;
  let buildResult: BuildResult | undefined;
  try {
    const result = deps.buildInvoice(
      input,
      cell.vatIdEvidence === undefined ? {} : { vatIdEvidence: cell.vatIdEvidence },
    );
    const category = result.decisions[0]?.categoryCode;
    if (category === undefined) {
      throw new Error(`buildInvoice returned no decisions for cell "${cell.id}"`);
    }
    build = { kind: "ok", category };
    buildResult = result;
  } catch (error) {
    build = { kind: "error", ...errorOf(error) };
  }

  let profile: ProfileAxisOutcome;
  try {
    const resolvedProfile = deps.selectProfile({
      buyerCountry: input.buyer.countryCode,
      leitwegId: input.references?.leitwegId,
      preferredProfile: cell.selectProfileOptions?.preferredProfile,
    });
    profile = { kind: "ok", profile: resolvedProfile };
  } catch (error) {
    profile = { kind: "error", ...errorOf(error) };
  }

  return { input, build, buildResult, profile };
}
