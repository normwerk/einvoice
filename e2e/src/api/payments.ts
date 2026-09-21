import type { AdminSession } from "./admin.js";
import { adminGetJson, adminPostJson } from "./admin.js";

export interface OrderPayment {
  readonly id: string;
  readonly amount: number;
}

/** The order's single payment — every scenario in this suite pays for one order in one payment
 * collection, so "the" payment is unambiguous. */
export async function getOrderPayment(admin: AdminSession, orderId: string): Promise<OrderPayment> {
  const response = await adminGetJson<{
    readonly order: {
      readonly payment_collections?: readonly {
        readonly payments?: readonly { readonly id: string; readonly amount: number }[];
      }[];
    };
  }>(admin, `/admin/orders/${orderId}?fields=id,*payment_collections.payments`);
  const payment = response.order.payment_collections?.[0]?.payments?.[0];
  if (payment === undefined) {
    throw new Error(`getOrderPayment: no payment found for order ${orderId}`);
  }
  return payment;
}

/** Real `POST /admin/payments/:id/capture` — verified against a real run: `pp_system_default` authorizes
 * but does not auto-capture, and a refund needs a captured payment first. */
export async function capturePayment(admin: AdminSession, paymentId: string): Promise<void> {
  await adminPostJson(admin, `/admin/payments/${paymentId}/capture`, {});
}

/** Real `POST /admin/payments/:id/refund` — this is what actually emits `payment.refunded`
 * (`docs/domain-glossary.md`'s own finding: payload is `{ id }`, the *payment's* id) and triggers the
 * plugin's credit-note subscriber. */
export async function refundPayment(
  admin: AdminSession,
  paymentId: string,
  amount: number,
): Promise<void> {
  await adminPostJson(admin, `/admin/payments/${paymentId}/refund`, { amount });
}
