import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { customerOwnsOrder, sendEinvoiceFile } from "../../../../../../einvoice-http.js";

export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse): Promise<void> {
  const orderId = req.params["id"] as string;
  if (!(await customerOwnsOrder(req, orderId))) {
    res.status(404).json({ message: `No order ${orderId}.` });
    return;
  }
  await sendEinvoiceFile(req, res, {
    orderId,
    documentId: req.params["documentId"] as string,
    kind: "pdf",
  });
}
