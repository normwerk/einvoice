/**
 * plan-e2e.md §5 rule 1: "ожидание — только опросом с таймаутом и внятным сообщением при истечении. Ни
 * одного sleep." A fixed delay is a future flake (subscribers fire asynchronously); this always polls a
 * real condition and fails with a message naming what it was waiting for, not a bare timeout.
 */
export async function waitFor(
  description: string,
  check: () => Promise<boolean>,
  options: { readonly timeoutMs?: number; readonly intervalMs?: number } = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 60_000;
  const intervalMs = options.intervalMs ?? 500;
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  for (;;) {
    try {
      if (await check()) {
        return;
      }
      lastError = undefined;
    } catch (error) {
      lastError = error;
    }
    if (Date.now() >= deadline) {
      const cause = lastError instanceof Error ? `: ${lastError.message}` : "";
      throw new Error(
        `waitFor(${JSON.stringify(description)}) timed out after ${timeoutMs}ms${cause}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

/** `waitFor` specialized for "this URL answers 200" — used for every service the stand's own compose
 * healthchecks don't already gate (Medusa's own boot is compose-gated too, but scenario code sometimes
 * needs to wait on a specific document appearing, which is a different condition per call site). */
export async function waitForHttpOk(
  description: string,
  url: string,
  options?: { readonly timeoutMs?: number; readonly intervalMs?: number },
): Promise<void> {
  await waitFor(
    description,
    async () => {
      const response = await fetch(url);
      return response.ok;
    },
    options,
  );
}
