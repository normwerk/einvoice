import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";

/** P-71: an order's e-invoices read with the order, through the plugin's read-only link. Stand only. */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);
  const { data } = await query.graph({
    entity: "order",
    filters: { id: req.params["id"] as string },
    fields: ["id", "einvoice_documents.*"],
  });
  res.status(200).json({ order: data[0] ?? null });
}
