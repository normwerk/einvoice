/**
 * T-074: `GET /admin/orders/:id/einvoice` — lists this order's e-invoice documents for the admin widget
 * (`src/admin/widgets/order-einvoice.tsx`). No auth middleware of its own beyond Medusa's own standard
 * admin-user session (already required for every `/admin/*` route by the host application) — an admin
 * user is trusted with any order's data already, unlike the store routes (`../../../store/orders/[id]/
 * einvoice/route.ts`'s own doc comment on why *that* tree needs its own ownership check.
 */
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { listEinvoiceDocumentSummaries } from "../../../../einvoice-http.js";

export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const orderId = req.params.id as string;
  const documents = await listEinvoiceDocumentSummaries(req, orderId, `/admin/orders/${orderId}`);
  res.status(200).json({ documents });
}
