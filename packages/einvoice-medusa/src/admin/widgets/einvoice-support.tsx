/**
 * T-077: what this release of the plugin supports, on the store's settings page (zone
 * `store.details.after`) — the seller country it is configured for, the documents, the buyers it serves and
 * the ones it refuses, from `GET /admin/einvoice/support`. A merchant sees the limits before an order hits
 * them; each refusal on an order links to its explanation (`order-einvoice.tsx`).
 */
import { defineWidgetConfig } from "@medusajs/admin-sdk";
import { Container, Heading, Text } from "@medusajs/ui";
import { useEffect, useState } from "react";

interface EinvoiceSupportStatus {
  readonly support: string;
  readonly sellerCountry: string;
  readonly errorReferenceUrl: string;
}

type LoadState =
  | { readonly status: "loading" }
  | { readonly status: "error" }
  | ({ readonly status: "ready" } & EinvoiceSupportStatus);

const EinvoiceSupportWidget = () => {
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    fetch("/admin/einvoice/support", { credentials: "include" })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        return response.json() as Promise<EinvoiceSupportStatus>;
      })
      .then((body) => {
        if (!cancelled) {
          setState({ status: "ready", ...body });
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
  }, []);

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <Heading level="h2">E-Invoicing</Heading>
      </div>
      <div className="flex flex-col gap-2 px-6 py-4">
        {state.status === "loading" && (
          <Text size="small" className="text-ui-fg-muted">
            Loading...
          </Text>
        )}
        {state.status === "error" && (
          <Text size="small" className="text-ui-fg-error">
            Failed to load the e-invoicing status
          </Text>
        )}
        {state.status === "ready" && (
          <>
            <Text size="small">Invoicing as a seller in {state.sellerCountry}.</Text>
            <Text size="small" className="text-ui-fg-subtle">
              {state.support}
            </Text>
            <a
              href={state.errorReferenceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-ui-fg-interactive hover:text-ui-fg-interactive-hover text-xs"
            >
              Why an invoice was not issued — error reference
            </a>
          </>
        )}
      </div>
    </Container>
  );
};

export const config = defineWidgetConfig({
  zone: "store.details.after",
});

export default EinvoiceSupportWidget;
