import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260914202237 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `alter table if exists "einvoice_document" drop constraint if exists "einvoice_document_type_idempotency_key_unique";`,
    );
    this.addSql(
      `create table if not exists "einvoice_counter" ("series" text not null, "value" integer not null default 0, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "einvoice_counter_pkey" primary key ("series"));`,
    );
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "IDX_einvoice_counter_deleted_at" ON "einvoice_counter" ("deleted_at") WHERE deleted_at IS NULL;`,
    );

    this.addSql(
      `create table if not exists "einvoice_document" ("id" text not null, "type" text check ("type" in ('invoice', 'credit_note')) not null, "order_id" text not null, "idempotency_key" text not null, "document_number" text not null, "xml" text not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "einvoice_document_pkey" primary key ("id"));`,
    );
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "IDX_einvoice_document_deleted_at" ON "einvoice_document" ("deleted_at") WHERE deleted_at IS NULL;`,
    );
    this.addSql(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_einvoice_document_type_idempotency_key_unique" ON "einvoice_document" ("type", "idempotency_key") WHERE deleted_at IS NULL;`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "einvoice_counter" cascade;`);

    this.addSql(`drop table if exists "einvoice_document" cascade;`);
  }
}
