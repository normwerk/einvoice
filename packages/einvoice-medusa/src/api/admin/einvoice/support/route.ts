/**
 * T-077: `GET /admin/einvoice/support` — what this release supports, for the store page's status widget
 * (`src/admin/widgets/einvoice-support.tsx`). Behind Medusa's admin session like every `/admin/*` route.
 */
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { einvoiceSupportStatus } from "../../../einvoice-http.js";

export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  res.status(200).json(await einvoiceSupportStatus(req));
}
