/**
 * T-074: "Download e-invoice" widget on the order detail page (plan-v0.1 §4.6/W10's own acceptance
 * criterion). Zone `order.details.side.after` — the side-panel column, matching `@webbers/invoices-medusa`'s
 * own real invoice widget (`.medusa/server/src/admin/index.js`, inspected directly, T-072) which uses the
 * adjacent `order.details.side.before` for the same kind of content, not a guessed placement.
 *
 * Plain `fetch(..., { credentials: "include" })` rather than `@medusajs/js-sdk`'s configured client
 * (Webbers' own widget uses that, `auth: { type: "session" }`) — a deliberate, smaller choice: this plugin
 * doesn't otherwise depend on `@medusajs/js-sdk`/`@tanstack/react-query`, and same-origin
 * `credentials: "include"` carries the exact same admin session cookie their client wraps, confirmed
 * working end to end against a real running dashboard (this task's own e2e proof), not assumed from
 * Webbers' precedent alone.
 */
import { defineWidgetConfig } from "@medusajs/admin-sdk";
import { Container, Heading, IconButton, Text } from "@medusajs/ui";
import { ArrowDownTray } from "@medusajs/icons";
import { useEffect, useState } from "react";
import type { DetailWidgetProps, HttpTypes } from "@medusajs/framework/types";

interface EinvoiceDocumentSummary {
  readonly id: string;
  readonly type: "invoice" | "credit_note";
  readonly documentNumber: string;
  readonly xmlUrl: string;
  readonly pdfUrl: string | null;
}

type LoadState =
  | { readonly status: "loading" }
  | { readonly status: "error" }
  | { readonly status: "ready"; readonly documents: readonly EinvoiceDocumentSummary[] };

function documentLabel(document: EinvoiceDocumentSummary): string {
  return `${document.type === "invoice" ? "Invoice" : "Credit note"} ${document.documentNumber}`;
}

const OrderEinvoiceWidget = ({ data: order }: DetailWidgetProps<HttpTypes.AdminOrder>) => {
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    fetch(`/admin/orders/${order.id}/einvoice`, { credentials: "include" })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        return response.json() as Promise<{
          readonly documents: readonly EinvoiceDocumentSummary[];
        }>;
      })
      .then((body) => {
        if (!cancelled) {
          setState({ status: "ready", documents: body.documents });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setState({ status: "error" });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [order.id]);

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <Heading level="h2">E-Invoices</Heading>
      </div>
      <div className="px-6 py-4">
        {state.status === "loading" && (
          <Text size="small" className="text-ui-fg-muted">
            Loading...
          </Text>
        )}
        {state.status === "error" && (
          <Text size="small" className="text-ui-fg-error">
            Failed to load e-invoices
          </Text>
        )}
        {state.status === "ready" && state.documents.length === 0 && (
          <Text size="small" className="text-ui-fg-muted">
            No e-invoices yet
          </Text>
        )}
        {state.status === "ready" && state.documents.length > 0 && (
          <div className="flex flex-col gap-3">
            {state.documents.map((document) => (
              <div key={document.id} className="flex items-center justify-between">
                <Text size="small">{documentLabel(document)}</Text>
                <div className="flex items-center gap-1">
                  <a href={document.xmlUrl} target="_blank" rel="noopener noreferrer">
                    <IconButton
                      size="small"
                      variant="transparent"
                      aria-label={`Download XML for ${documentLabel(document)}`}
                    >
                      <ArrowDownTray />
                    </IconButton>
                  </a>
                  {document.pdfUrl !== null && (
                    <a href={document.pdfUrl} target="_blank" rel="noopener noreferrer">
                      <IconButton
                        size="small"
                        variant="transparent"
                        aria-label={`Download PDF for ${documentLabel(document)}`}
                      >
                        <ArrowDownTray />
                      </IconButton>
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Container>
  );
};

export const config = defineWidgetConfig({
  zone: "order.details.side.after",
});

export default OrderEinvoiceWidget;
