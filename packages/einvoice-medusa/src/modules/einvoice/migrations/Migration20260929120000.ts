import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/** T-201: `einvoice_document.price_notices` — prices an order edit changed after the invoice was issued. */
export class Migration20260929120000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `alter table if exists "einvoice_document" add column if not exists "price_notices" jsonb null;`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "einvoice_document" drop column if exists "price_notices";`);
  }
}
