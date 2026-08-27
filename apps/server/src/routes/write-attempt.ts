/**
 * Shared plumbing for the admin config writes.
 *
 * Every settings/config route has the same shape: take an unknown body, hand it
 * to a Zod-backed setter (and whatever hot-apply the change needs), and turn a
 * rejection — a schema failure, or the persist itself failing — into a 400
 * carrying the reason. Keeping that in one place stops a dozen route handlers
 * from repeating the same try/catch, and keeps the `status(400, …)` call at the
 * call site so each route's response type stays exactly what it was.
 */

/** The reason an unknown throw carries, or `fallback` when it isn't an Error. */
export const errorMessage = (error: unknown, fallback: string): string =>
  error instanceof Error ? error.message : fallback;

/** A completed write, or the reason it was rejected. */
export type Attempt<T> = { ok: true; value: T } | { ok: false; error: string };

/** Run a config write, capturing any rejection as a 400-worthy reason. */
export async function attempt<T>(run: () => Promise<T>, fallback: string): Promise<Attempt<T>> {
  try {
    return { ok: true, value: await run() };
  } catch (error) {
    return { ok: false, error: errorMessage(error, fallback) };
  }
}
