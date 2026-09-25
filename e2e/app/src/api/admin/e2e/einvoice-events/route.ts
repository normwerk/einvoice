import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { einvoiceEventLog } from "../../../../lib/einvoice-event-log";

/** P-71: what the stand's subscriber received of the plugin's events. Stand only. */
export async function GET(_req: MedusaRequest, res: MedusaResponse): Promise<void> {
  res.status(200).json({ events: einvoiceEventLog });
}
