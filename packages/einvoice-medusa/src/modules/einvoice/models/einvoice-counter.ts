/**
 * T-071: backs this plugin's own implementation of `@normwerk/einvoice-commerce`'s `NumberingStore`
 * interface (`numbering.ts`, ADR-001's I/O boundary: "a platform adapter backs it with its own database
 * transaction") with a real, race-safe Postgres counter — one row per series (`invoice-2026`,
 * `credit-note-2026`, ...). `series` is the primary key directly (`model.text().primaryKey()` — a real,
 * documented DML pattern, `@medusajs/framework/utils`'s own doc comment for `TextProperty.primaryKey()`
 * uses exactly this shape: `code: model.text().primaryKey()`), no separate surrogate `id` needed for a
 * table that's never looked up any other way.
 *
 * `numbering-store.ts`'s `allocateNext` increments this with a single atomic
 * `INSERT ... ON CONFLICT (series) DO UPDATE ... RETURNING value` — not a read-then-write from application
 * code, which would race under concurrent fulfillment events the same way `einvoice-commerce`'s own
 * `InMemoryNumberingStore` doc comment warns a naive implementation could (that class is safe only because
 * JS never awaits between its read and write; a Postgres round-trip does, so this table needs the
 * database's own atomicity instead).
 */
import { model } from "@medusajs/framework/utils";

const EinvoiceCounter = model.define("EinvoiceCounter", {
  series: model.text().primaryKey(),
  value: model.number().default(0),
});

export default EinvoiceCounter;
