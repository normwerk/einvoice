import { MEDUSA_URL } from "../harness/env.js";

async function parseErrorBody(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "<no body>";
  }
}

/** Every Store API call needs the seeded default publishable key (`x-publishable-api-key`) — no auth
 * beyond that for the cart/checkout flow itself (a real, unauthenticated buyer checking out), verified
 * against a real run. */
export async function storeFetch(
  publishableKey: string,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("x-publishable-api-key", publishableKey);
  if (init.body !== undefined && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  return fetch(`${MEDUSA_URL}${path}`, { ...init, headers });
}

export async function storePostJson<T>(
  publishableKey: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const response = await storeFetch(publishableKey, path, {
    method: "POST",
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) {
    throw new Error(`POST ${path} -> ${response.status}: ${await parseErrorBody(response)}`);
  }
  return (await response.json()) as T;
}

export async function storeGetJson<T>(publishableKey: string, path: string): Promise<T> {
  const response = await storeFetch(publishableKey, path);
  if (!response.ok) {
    throw new Error(`GET ${path} -> ${response.status}: ${await parseErrorBody(response)}`);
  }
  return (await response.json()) as T;
}
