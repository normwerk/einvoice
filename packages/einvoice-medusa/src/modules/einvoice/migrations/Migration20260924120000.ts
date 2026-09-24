import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/** P-63: `einvoice_document.notice` and the `einvoice_refusal` table. */
export class Migration20260924120000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `alter table if exists "einvoice_document" add column if not exists "notice" jsonb null;`,
    );
    this.addSql(
      `create table if not exists "einvoice_refusal" ("id" text not null, "type" text check ("type" in ('invoice', 'credit_note')) not null, "order_id" text not null, "idempotency_key" text not null, "code" text not null, "details" jsonb not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "einvoice_refusal_pkey" primary key ("id"));`,
    );
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "IDX_einvoice_refusal_deleted_at" ON "einvoice_refusal" ("deleted_at") WHERE deleted_at IS NULL;`,
    );
    this.addSql(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_einvoice_refusal_type_idempotency_key_unique" ON "einvoice_refusal" ("type", "idempotency_key") WHERE deleted_at IS NULL;`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "einvoice_refusal" cascade;`);

    this.addSql(`alter table if exists "einvoice_document" drop column if exists "notice";`);
  }
}
