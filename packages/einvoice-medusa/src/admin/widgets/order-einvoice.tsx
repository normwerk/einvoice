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
 *
 * P-63: a document issued with a notice shows it under its row (the buyer overpaid, or Medusa counts VAT
 * differently), and a document the plugin did not issue shows why, with a "Retry" button
 * (`POST /admin/orders/:id/einvoice/refusals/:refusalId/retry`) for after the order was corrected.
 */
import { defineWidgetConfig } from "@medusajs/admin-sdk";
import { Badge, Button, Container, Heading, IconButton, Text } from "@medusajs/ui";
import { ArrowDownTray } from "@medusajs/icons";
import { useCallback, useEffect, useState } from "react";
import type { DetailWidgetProps, HttpTypes } from "@medusajs/framework/types";

interface EinvoiceDocumentSummary {
  readonly id: string;
  readonly type: "invoice" | "credit_note";
  readonly documentNumber: string;
  readonly xmlUrl: string;
  readonly pdfUrl: string | null;
  readonly notice: { readonly code: string; readonly message: string } | null;
}

interface EinvoiceRefusalSummary {
  readonly id: string;
  readonly type: "invoice" | "credit_note";
  readonly code: string;
  readonly message: string;
  readonly retryUrl: string;
}

interface EinvoiceStatus {
  readonly documents: readonly EinvoiceDocumentSummary[];
  readonly refusals: readonly EinvoiceRefusalSummary[];
}

type LoadState =
  | { readonly status: "loading" }
  | { readonly status: "error" }
  | ({ readonly status: "ready" } & EinvoiceStatus);

function documentLabel(document: EinvoiceDocumentSummary): string {
  return `${document.type === "invoice" ? "Invoice" : "Credit note"} ${document.documentNumber}`;
}

const OrderEinvoiceWidget = ({ data: order }: DetailWidgetProps<HttpTypes.AdminOrder>) => {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [reload, setReload] = useState(0);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [retryError, setRetryError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    fetch(`/admin/orders/${order.id}/einvoice`, { credentials: "include" })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        return response.json() as Promise<EinvoiceStatus>;
      })
      .then((body) => {
        if (!cancelled) {
          setState({ status: "ready", documents: body.documents, refusals: body.refusals ?? [] });
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
  }, [order.id, reload]);

  const retry = useCallback(async (refusal: EinvoiceRefusalSummary) => {
    setRetrying(refusal.id);
    setRetryError(null);
    try {
      const response = await fetch(refusal.retryUrl, { method: "POST", credentials: "include" });
      const body = (await response.json()) as { readonly message?: string };
      if (!response.ok) {
        setRetryError(body.message ?? `HTTP ${response.status}`);
      }
    } catch {
      setRetryError("Retry failed");
    } finally {
      setRetrying(null);
      setReload((value) => value + 1);
    }
  }, []);

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
        {state.status === "ready" && state.refusals.length > 0 && (
          <div className="mb-3 flex flex-col gap-3">
            {state.refusals.map((refusal) => (
              <div key={refusal.id} className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <Badge size="2xsmall" color="red">
                    {refusal.type === "invoice" ? "Invoice not issued" : "Credit note not issued"}
                  </Badge>
                  <Button
                    size="small"
                    variant="secondary"
                    isLoading={retrying === refusal.id}
                    onClick={() => void retry(refusal)}
                  >
                    Retry
                  </Button>
                </div>
                <Text size="small" className="text-ui-fg-subtle">
                  {refusal.message} [{refusal.code}]
                </Text>
              </div>
            ))}
            {retryError !== null && (
              <Text size="small" className="text-ui-fg-error">
                {retryError}
              </Text>
            )}
          </div>
        )}
        {state.status === "ready" &&
          state.documents.length === 0 &&
          state.refusals.length === 0 && (
            <Text size="small" className="text-ui-fg-muted">
              No e-invoices yet
            </Text>
          )}
        {state.status === "ready" && state.documents.length > 0 && (
          <div className="flex flex-col gap-3">
            {state.documents.map((document) => (
              <div key={document.id} className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
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
                {document.notice !== null && (
                  <div className="flex flex-col gap-1">
                    <Badge size="2xsmall" color="orange" className="self-start">
                      {document.notice.code === "VAT_OVERCHARGED"
                        ? "Refund due"
                        : "VAT differs from Medusa"}
                    </Badge>
                    <Text size="small" className="text-ui-fg-subtle">
                      {document.notice.message} [{document.notice.code}]
                    </Text>
                  </div>
                )}
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
