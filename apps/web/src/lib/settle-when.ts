/** The store contract `settleWhen` needs — nanostores' `subscribe`, which Better Auth's `useSession()` returns. */
export interface Subscribable<T> {
  subscribe(listener: (value: T) => void): () => void;
}

/**
 * Resolve once `store` holds a value `ready` accepts, or after `timeoutMs`.
 *
 * nanostores calls a new listener SYNCHRONOUSLY with the current value, so a
 * store that is already ready settles inside `subscribe` — before it has
 * returned the unsubscribe function. The inline version of this in
 * `AuthForm.svelte` called that function from inside the first callback,
 * hit the temporal dead zone, and left the sign-in button on "Signing in…"
 * forever. That is exactly the state after a session expires: the client
 * still caches the old session, so signing in again could never complete.
 */
export function settleWhen<T>(
  store: Subscribable<T>,
  ready: (value: T) => boolean,
  timeoutMs: number,
): Promise<void> {
  return new Promise((done) => {
    let settled = false;
    let unsubscribe: (() => void) | null = null;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      unsubscribe?.();
      done();
    };
    const timer = setTimeout(finish, timeoutMs);
    unsubscribe = store.subscribe((value) => {
      if (ready(value)) finish();
    });
    // Settled during `subscribe` itself: release the listener now that we hold it.
    if (settled) unsubscribe();
  });
}
