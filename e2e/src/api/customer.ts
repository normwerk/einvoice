import type { AdminSession } from "./admin.js";
import { adminPostJson } from "./admin.js";
import { storePostJson } from "./store.js";

export interface CustomerSession {
  readonly customerId: string;
  readonly token: string;
}

/**
 * A real Store API customer registration + login, verified against a real run:
 * `POST /auth/customer/emailpass/register` (an auth identity only, no customer profile yet) ->
 * `POST /store/customers` (the actual profile — `companyName` here becomes `customer.company_name`, which
 * is what `buyerIsBusiness` in `order-to-commerce-invoice-input.ts` reads; the cart/order address's own
 * `company` field is a *different* thing the adapter never looks at for this decision, a real gap a
 * fixture-only test would never catch) -> a fresh login for a normal session token (the registration
 * token is single-purpose and only valid for creating the profile, confirmed by a real 401 otherwise).
 */
export async function registerCustomer(
  publishableKey: string,
  input: { readonly email: string; readonly password: string; readonly companyName: string },
): Promise<CustomerSession> {
  const { token: registrationToken } = await storePostJson<{ readonly token: string }>(
    publishableKey,
    "/auth/customer/emailpass/register",
    { email: input.email, password: input.password },
  );

  const created = await storePostJson<{ readonly customer: { readonly id: string } }>(
    publishableKey,
    "/store/customers",
    { email: input.email, company_name: input.companyName },
    registrationToken,
  );

  const session = await loginCustomer(publishableKey, {
    email: input.email,
    password: input.password,
  });
  return { ...session, customerId: created.customer.id };
}

export async function loginCustomer(
  publishableKey: string,
  input: { readonly email: string; readonly password: string },
): Promise<CustomerSession> {
  const { token } = await storePostJson<{ readonly token: string }>(
    publishableKey,
    "/auth/customer/emailpass",
    input,
  );
  return { customerId: "", token };
}

/** Sets `customer.metadata.vat_id` (the buyer VAT-ID convention `docs/quickstart-medusa.md` documents) via
 * the admin API — simpler than a store-side self-service metadata update, and this suite already has an
 * admin session for everything else. */
export async function setCustomerVatId(
  admin: AdminSession,
  customerId: string,
  vatId: string,
): Promise<void> {
  await adminPostJson(admin, `/admin/customers/${customerId}`, { metadata: { vat_id: vatId } });
}

/** Sets `customer.metadata` keys the plugin reads (`docs/quickstart-medusa.md`), e.g. `leitweg_id`. */
export async function setCustomerMetadata(
  admin: AdminSession,
  customerId: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  await adminPostJson(admin, `/admin/customers/${customerId}`, { metadata });
}
