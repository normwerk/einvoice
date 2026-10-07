/**
 * T-214 (P-81): the dry run's register — the invoices it planned, by order, on top of the ones the plugin
 * issued. Planning an order's fulfillments in turn, each plan reads what the earlier ones took (units,
 * discount, the shipping) from here, as the plugin reads its issued documents; nothing is written anywhere.
 */
import type { InvoiceRecordForPlan, InvoiceRecordSource } from "../invoices/issue-invoice.js";

export class DryRunRegister implements InvoiceRecordSource {
  private readonly planned = new Map<string, InvoiceRecordForPlan[]>();
  private readonly plannedFulfillments = new Set<string>();

  /** @param issued the plugin's own documents, or `null` where it has none — its tables are not there yet. */
  constructor(private readonly issued: InvoiceRecordSource | null) {}

  async hasInvoice(fulfillmentId: string): Promise<boolean> {
    return (
      this.plannedFulfillments.has(fulfillmentId) ||
      (this.issued !== null && (await this.issued.hasInvoice(fulfillmentId)))
    );
  }

  async invoicesOfOrder(orderId: string): Promise<readonly InvoiceRecordForPlan[]> {
    const issued = this.issued === null ? [] : await this.issued.invoicesOfOrder(orderId);
    return [...issued, ...(this.planned.get(orderId) ?? [])];
  }

  /** Records an invoice the run planned — the order's next plans take it into account. */
  add(orderId: string, invoice: InvoiceRecordForPlan): void {
    this.planned.set(orderId, [...(this.planned.get(orderId) ?? []), invoice]);
    this.plannedFulfillments.add(invoice.idempotency_key);
  }
}
