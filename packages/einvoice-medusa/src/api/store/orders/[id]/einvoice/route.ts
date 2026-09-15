/**
 * T-074: `GET /store/orders/:id/einvoice` — a logged-in customer's own view of their order's e-invoice
 * documents. Requires `authenticate("customer", ["session", "bearer"])` (wired in `../../../../
 * middlewares.ts`, this file's own handler does not re-check auth) *and* that the authenticated customer
 * actually owns this order (`customerOwnsOrder`) — see `einvoice-http.ts`'s own doc comment on
 * `customerOwnsOrder` for why this plugin does not follow Medusa's own `GET /store/orders/:id` precedent
 * of skipping that check. A mismatch returns 404, not 403 — this route does not confirm to a caller that
 * an order id exists at all when they don't own it.
 */
import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { customerOwnsOrder, listEinvoiceDocumentSummaries } from "../../../../einvoice-http.js";

export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse): Promise<void> {
  const orderId = req.params["id"] as string;
  if (!(await customerOwnsOrder(req, orderId))) {
    res.status(404).json({ message: `No order ${orderId}.` });
    return;
  }
  const documents = await listEinvoiceDocumentSummaries(req, orderId, `/store/orders/${orderId}`);
  res.status(200).json({ documents });
}
