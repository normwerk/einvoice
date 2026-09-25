/**
 * P-71 (M-047): an order's e-invoices, readable with the order — `query.graph({ entity: "order", fields:
 * ["einvoice_documents.*"] })` — through the document's own `order_id`. Read-only (`defineLink`'s
 * `readOnly`, `@medusajs/utils` `modules-sdk/define-link.js`, the same in 2.12 and 2.19): no link table, no
 * migration, nothing to keep in step. What a document exposes is `EinvoiceDocumentDTO` (`src/events.ts`).
 */
import OrderModule from "@medusajs/medusa/order";
import { defineLink } from "@medusajs/framework/utils";
import EinvoiceModule from "../modules/einvoice/index.js";

export default defineLink(
  { linkable: OrderModule.linkable["order"], field: "id" },
  { ...EinvoiceModule.linkable.einvoiceDocument.id, primaryKey: "order_id" },
  { readOnly: true, isList: true },
);
