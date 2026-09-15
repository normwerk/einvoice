import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { sendEinvoiceFile } from "../../../../../../einvoice-http.js";

export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  await sendEinvoiceFile(req, res, {
    orderId: req.params.id as string,
    documentId: req.params.documentId as string,
    kind: "xml",
  });
}
