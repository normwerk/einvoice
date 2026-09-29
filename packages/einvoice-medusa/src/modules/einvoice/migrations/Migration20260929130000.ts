import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/** T-033: `einvoice_document.pdf_notice` — a document issued as XML alone, and why. */
export class Migration20260929130000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `alter table if exists "einvoice_document" add column if not exists "pdf_notice" jsonb null;`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "einvoice_document" drop column if exists "pdf_notice";`);
  }
}
