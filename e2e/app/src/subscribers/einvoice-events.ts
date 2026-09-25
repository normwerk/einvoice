import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework";
import type { DocumentIssuedEvent, IssuanceBlockedEvent } from "@normwerk/einvoice-medusa/events";
import { einvoiceEventLog } from "../lib/einvoice-event-log";

/** P-71: a shop's own subscriber to the plugin's events — here it only records them. */
export default async function einvoiceEvents({
  event,
}: SubscriberArgs<DocumentIssuedEvent | IssuanceBlockedEvent>): Promise<void> {
  einvoiceEventLog.push({ name: event.name, data: event.data });
}

export const config: SubscriberConfig = {
  event: ["einvoice.document_issued", "einvoice.issuance_blocked"],
};
