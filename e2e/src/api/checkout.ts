import { storePostJson } from "./store.js";

export interface BuyerAddress {
  readonly firstName: string;
  readonly lastName: string;
  readonly addressLine1: string;
  readonly city: string;
  readonly postalCode: string;
  readonly countryCode: string;
  readonly company?: string;
}

export interface CheckoutInput {
  readonly publishableKey: string;
  readonly regionId: string;
  readonly salesChannelId: string;
  readonly variantId: string;
  /** Omitted for a cart whose items need no shipping (a service) — Medusa then completes it without a
   * shipping method. */
  readonly shippingOptionId?: string;
  readonly email: string;
  readonly address: BuyerAddress;
  readonly quantity?: number;
  /** Promotion codes applied to the cart before checkout (`POST /store/carts/:id/promotions`). */
  readonly promoCodes?: readonly string[];
  /** A registered customer's own session token (`customer.ts`) — attaches `customer_id` to the cart/order
   * (verified against a real run: carrying this bearer token on cart creation is what does it, not a
   * separate "claim this cart" call). Omitted for a guest checkout (S1). */
  readonly customerToken?: string;
}

export interface CheckoutResult {
  readonly orderId: string;
  readonly cartId: string;
}

function toStoreAddress(address: BuyerAddress): Record<string, string> {
  return {
    first_name: address.firstName,
    last_name: address.lastName,
    address_1: address.addressLine1,
    city: address.city,
    postal_code: address.postalCode,
    country_code: address.countryCode,
    ...(address.company === undefined ? {} : { company: address.company }),
  };
}

/**
 * A real, unauthenticated Store API checkout (guest — no customer registration), verified step by step
 * against a real run: cart → email/addresses → shipping method → payment collection/session → complete.
 * Every scenario that doesn't need a registered customer (S1; S2/S4 need one, for the VAT-ID metadata and
 * for the Store API ownership check respectively — a separate, later entry point, not this one) goes
 * through this same sequence, matching the plan's own "через Admin/Store HTTP API" (plan-e2e.md §4).
 */
export async function checkoutToOrder(input: CheckoutInput): Promise<CheckoutResult> {
  const { publishableKey, customerToken } = input;

  const created = await storePostJson<{ readonly cart: { readonly id: string } }>(
    publishableKey,
    "/store/carts",
    {
      region_id: input.regionId,
      sales_channel_id: input.salesChannelId,
      items: [{ variant_id: input.variantId, quantity: input.quantity ?? 1 }],
    },
    customerToken,
  );
  const cartId = created.cart.id;

  await storePostJson(
    publishableKey,
    `/store/carts/${cartId}`,
    {
      email: input.email,
      billing_address: toStoreAddress(input.address),
      shipping_address: toStoreAddress(input.address),
    },
    customerToken,
  );

  if (input.promoCodes !== undefined) {
    await storePostJson(
      publishableKey,
      `/store/carts/${cartId}/promotions`,
      { promo_codes: input.promoCodes },
      customerToken,
    );
  }

  if (input.shippingOptionId !== undefined) {
    await storePostJson(
      publishableKey,
      `/store/carts/${cartId}/shipping-methods`,
      { option_id: input.shippingOptionId },
      customerToken,
    );
  }

  const paymentCollection = await storePostJson<{
    readonly payment_collection: { readonly id: string };
  }>(publishableKey, "/store/payment-collections", { cart_id: cartId }, customerToken);

  await storePostJson(
    publishableKey,
    `/store/payment-collections/${paymentCollection.payment_collection.id}/payment-sessions`,
    { provider_id: "pp_system_default" },
    customerToken,
  );

  const completed = await storePostJson<{
    readonly type: string;
    readonly order?: { readonly id: string };
    readonly error?: unknown;
  }>(publishableKey, `/store/carts/${cartId}/complete`, undefined, customerToken);
  if (completed.type !== "order" || completed.order === undefined) {
    throw new Error(
      `checkoutToOrder: cart did not complete into an order: ${JSON.stringify(completed)}`,
    );
  }

  return { orderId: completed.order.id, cartId };
}
