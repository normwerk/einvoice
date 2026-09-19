/**
 * Reads every `packages/einvoice-medusa/fixtures/tax-matrix/<id>/` directory into a `TaxMatrixCell` — plain
 * `fs` + `JSON.parse`, no framework, so both the fast vitest suite (`tax-matrix.test.ts`) and the Docker
 * conformance gate (`tools/conformance/run-tax-matrix.mjs`) load the exact same fixtures.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import type {
  MapOrderOptions,
  MedusaOrderForInvoice,
} from "../mapping/order-to-commerce-invoice-input.js";
import type { CellExpectation, TaxMatrixCell } from "./types.js";

// `__dirname`, not `import.meta.url`: this package compiles to CommonJS (`medusa plugin:build`,
// `tsconfig.json`'s `module: "Node16"`, no `"type": "module"` in `package.json`) — the same reason
// `order-to-commerce-invoice-input.ts` never statically imports an ESM-only package's runtime values.
export const TAX_MATRIX_DIR = resolve(__dirname, "../../fixtures/tax-matrix");
const SHARED_SELLERS_FILE = resolve(TAX_MATRIX_DIR, "_shared/sellers.json");

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf-8")) as T;
}

export function loadSellers(): Record<string, MapOrderOptions["seller"]> {
  return readJson(SHARED_SELLERS_FILE);
}

/** Every cell directory under `TAX_MATRIX_DIR`, excluding `_shared` (not a cell) and any directory without
 * an `order.json` (a documentation-only known-gap entry with no runnable fixture — e.g. `row-11-*`). */
export function loadTaxMatrixCells(): readonly TaxMatrixCell[] {
  const sellers = loadSellers();
  const ids = readdirSync(TAX_MATRIX_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== "_shared")
    .map((entry) => entry.name)
    .sort();

  const cells: TaxMatrixCell[] = [];
  for (const id of ids) {
    const dir = resolve(TAX_MATRIX_DIR, id);
    const orderPath = resolve(dir, "order.json");
    if (!existsSync(orderPath)) {
      continue;
    }
    const order = readJson<MedusaOrderForInvoice>(orderPath);
    const cellOptions = readJson<{
      sellerKey: string;
      mapOptions: Omit<MapOrderOptions, "seller">;
    }>(resolve(dir, "map-options.json"));
    const selectProfileOptionsPath = resolve(dir, "select-profile-options.json");
    const selectProfileOptions = existsSync(selectProfileOptionsPath)
      ? readJson<TaxMatrixCell["selectProfileOptions"]>(selectProfileOptionsPath)
      : undefined;
    const vatIdEvidencePath = resolve(dir, "vat-id-evidence.json");
    const vatIdEvidence = existsSync(vatIdEvidencePath)
      ? readJson<TaxMatrixCell["vatIdEvidence"]>(vatIdEvidencePath)
      : undefined;
    const expected = readJson<CellExpectation>(resolve(dir, "expected.json"));

    if (!(cellOptions.sellerKey in sellers)) {
      throw new Error(`tax-matrix cell "${id}": unknown sellerKey "${cellOptions.sellerKey}"`);
    }

    cells.push({
      id,
      order,
      mapOptions: cellOptions.mapOptions,
      sellerKey: cellOptions.sellerKey,
      selectProfileOptions,
      vatIdEvidence,
      expected,
      dir,
    });
  }
  return cells;
}
