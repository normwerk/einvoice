import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";

/**
 * P-71: delivers `order.fulfillment_created` a second time to the plugin's subscriber, inside the running
 * app — where the stand's own subscriber listens for the plugin's events (a `medusa exec` process has an
 * event bus of its own). Awaited. Stand only.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { default: handler } =
    require("@normwerk/einvoice-medusa/subscribers/invoice-on-fulfillment-created") as {
      readonly default: (args: unknown) => Promise<void>;
    };
  const data = req.body as { readonly order_id: string; readonly fulfillment_id: string };
  await handler({
    event: { name: "order.fulfillment_created", data },
    container: req.scope,
    pluginOptions: {},
  });
  res.status(200).json({ redelivered: true });
}
