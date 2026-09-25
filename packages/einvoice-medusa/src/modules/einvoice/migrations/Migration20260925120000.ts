import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/** P-67: `einvoice_document.includes_shipping` (an invoice carrying the order's shipping) and
 * `corrected_document_id` (the invoice a credit note corrects). */
export class Migration20260925120000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `alter table if exists "einvoice_document" add column if not exists "includes_shipping" boolean not null default false;`,
    );
    this.addSql(
      `alter table if exists "einvoice_document" add column if not exists "corrected_document_id" text null;`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(
      `alter table if exists "einvoice_document" drop column if exists "includes_shipping";`,
    );
    this.addSql(
      `alter table if exists "einvoice_document" drop column if exists "corrected_document_id";`,
    );
  }
}
