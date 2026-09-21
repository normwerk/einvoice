import { ADMIN_EMAIL, ADMIN_PASSWORD, MEDUSA_URL } from "../harness/env.js";

export interface AdminSession {
  readonly token: string;
}

async function parseErrorBody(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "<no body>";
  }
}

/** Real `POST /auth/user/emailpass` against the admin user the Dockerfile's own `medusa user -e ... -p ...`
 * seeds at container start (`env.ts`'s `ADMIN_EMAIL`/`ADMIN_PASSWORD`) — verified against a real run. */
export async function adminLogin(): Promise<AdminSession> {
  const response = await fetch(`${MEDUSA_URL}/auth/user/emailpass`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  });
  if (!response.ok) {
    throw new Error(`admin login failed: ${response.status} ${await parseErrorBody(response)}`);
  }
  const { token } = (await response.json()) as { readonly token: string };
  return { token };
}

/** Raw admin-authenticated `fetch` — callers decide how to read the response (json, arrayBuffer, status
 * code) since some scenarios (idempotency, ownership, negative checks) assert on the status itself rather
 * than treating a non-2xx as a thrown error. */
export async function adminFetch(
  session: AdminSession,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${session.token}`);
  if (init.body !== undefined && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  return fetch(`${MEDUSA_URL}${path}`, { ...init, headers });
}

export async function adminGetJson<T>(session: AdminSession, path: string): Promise<T> {
  const response = await adminFetch(session, path);
  if (!response.ok) {
    throw new Error(`GET ${path} -> ${response.status}: ${await parseErrorBody(response)}`);
  }
  return (await response.json()) as T;
}

export async function adminPostJson<T>(
  session: AdminSession,
  path: string,
  body: unknown,
): Promise<T> {
  const response = await adminFetch(session, path, { method: "POST", body: JSON.stringify(body) });
  if (!response.ok) {
    throw new Error(`POST ${path} -> ${response.status}: ${await parseErrorBody(response)}`);
  }
  return (await response.json()) as T;
}
