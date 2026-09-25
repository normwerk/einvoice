import type { DocumentIssuedEvent, IssuanceBlockedEvent } from "@normwerk/einvoice-medusa/events";

/**
 * P-71: the plugin's events as a shop's own subscriber receives them — kept in memory for the end-to-end
 * suite to read (`GET /admin/e2e/einvoice-events`). The typed payloads come from the package as published.
 */
export const einvoiceEventLog: {
  readonly name: string;
  readonly data: DocumentIssuedEvent | IssuanceBlockedEvent;
}[] = [];
