import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/** T-192: `einvoice_document.vat_id_evidence` (the VIES answer an intra-EU supply rests on) and
 * `tax_decisions` (the rule each document followed). */
export class Migration20260925180000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `alter table if exists "einvoice_document" add column if not exists "vat_id_evidence" jsonb null;`,
    );
    this.addSql(
      `alter table if exists "einvoice_document" add column if not exists "tax_decisions" jsonb null;`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(
      `alter table if exists "einvoice_document" drop column if exists "vat_id_evidence";`,
    );
    this.addSql(`alter table if exists "einvoice_document" drop column if exists "tax_decisions";`);
  }
}
