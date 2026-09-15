/**
 * T-074: the store e-invoice routes need an authenticated customer (`einvoice-http.ts`'s own doc comment
 * on `customerOwnsOrder` explains why this plugin does not skip auth here the way Medusa's own
 * `GET /store/orders/:id` does) — `authenticate` is real middleware from `@medusajs/framework/http`, the
 * same function (and the same `["session", "bearer"]` combination) Medusa's own core store routes use for
 * every other customer-owned-order action (`/store/orders/:id/transfer/*`, confirmed by reading their
 * compiled `middlewares.js` directly, not assumed from the docs).
 */
import { authenticate, defineMiddlewares } from "@medusajs/framework/http";

export default defineMiddlewares({
  routes: [
    {
      method: ["GET"],
      matcher: "/store/orders/:id/einvoice",
      middlewares: [authenticate("customer", ["session", "bearer"])],
    },
    {
      method: ["GET"],
      matcher: "/store/orders/:id/einvoice/:documentId/xml",
      middlewares: [authenticate("customer", ["session", "bearer"])],
    },
    {
      method: ["GET"],
      matcher: "/store/orders/:id/einvoice/:documentId/pdf",
      middlewares: [authenticate("customer", ["session", "bearer"])],
    },
  ],
});
