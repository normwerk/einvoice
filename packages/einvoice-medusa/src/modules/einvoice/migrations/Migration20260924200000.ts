import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/** P-65: `einvoice_document.covered_returns`. */
export class Migration20260924200000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `alter table if exists "einvoice_document" add column if not exists "covered_returns" jsonb null;`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(
      `alter table if exists "einvoice_document" drop column if exists "covered_returns";`,
    );
  }
}
