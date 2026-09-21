import { MEDUSA_URL } from "../harness/env.js";

async function parseErrorBody(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "<no body>";
  }
}

/** Every Store API call needs the seeded default publishable key (`x-publishable-api-key`) — no auth
 * beyond that for a guest checkout (S1), verified against a real run. `token`, when given, is a real
 * customer session's own bearer token (`customer.ts`'s `registerCustomer`/`loginCustomer`) — what actually
 * attaches `customer_id` to a cart/order (S2/S4/store-ownership all need a real, registered buyer). */
export async function storeFetch(
  publishableKey: string,
  path: string,
  init: RequestInit = {},
  token?: string,
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("x-publishable-api-key", publishableKey);
  if (token !== undefined) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  if (init.body !== undefined && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  return fetch(`${MEDUSA_URL}${path}`, { ...init, headers });
}

export async function storePostJson<T>(
  publishableKey: string,
  path: string,
  body?: unknown,
  token?: string,
): Promise<T> {
  const response = await storeFetch(
    publishableKey,
    path,
    { method: "POST", ...(body === undefined ? {} : { body: JSON.stringify(body) }) },
    token,
  );
  if (!response.ok) {
    throw new Error(`POST ${path} -> ${response.status}: ${await parseErrorBody(response)}`);
  }
  return (await response.json()) as T;
}

export async function storeGetJson<T>(
  publishableKey: string,
  path: string,
  token?: string,
): Promise<T> {
  const response = await storeFetch(publishableKey, path, {}, token);
  if (!response.ok) {
    throw new Error(`GET ${path} -> ${response.status}: ${await parseErrorBody(response)}`);
  }
  return (await response.json()) as T;
}
