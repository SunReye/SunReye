import { describe, expect, test } from "bun:test";
import { settleWhen, type Subscribable } from "./settle-when";

/** A minimal nanostores-shaped store: `subscribe` calls back SYNCHRONOUSLY with the current value. */
function store<T>(initial: T) {
  let value = initial;
  const listeners = new Set<(v: T) => void>();
  let unsubscribed = 0;
  const subscribable: Subscribable<T> = {
    subscribe(listener) {
      listeners.add(listener);
      listener(value);
      return () => {
        unsubscribed += 1;
        listeners.delete(listener);
      };
    },
  };
  return {
    subscribable,
    set(next: T) {
      value = next;
      for (const l of listeners) l(next);
    },
    get listeners() {
      return listeners.size;
    },
    get unsubscribed() {
      return unsubscribed;
    },
  };
}

describe("settleWhen", () => {
  test("settles at once when the CURRENT value is already ready (synchronous first callback)", async () => {
    // The sign-in-after-a-401 case: the session store still holds the stale
    // session, so the very first callback is ready — before `subscribe` returns.
    const s = store({ data: "stale-session" as string | null });
    await settleWhen(s.subscribable, (v) => v.data !== null, 1000);
    expect(s.listeners).toBe(0);
    expect(s.unsubscribed).toBe(1);
  });

  test("waits for a later value that is ready", async () => {
    const s = store({ data: null as string | null });
    let settled = false;
    const done = settleWhen(s.subscribable, (v) => v.data !== null, 1000).then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    s.set({ data: "fresh" });
    await done;
    expect(settled).toBe(true);
    expect(s.listeners).toBe(0);
  });

  test("gives up after the timeout and still unsubscribes", async () => {
    const s = store({ data: null as string | null });
    await settleWhen(s.subscribable, (v) => v.data !== null, 5);
    expect(s.listeners).toBe(0);
    expect(s.unsubscribed).toBe(1);
  });

  test("a zero timeout settles without waiting for a value", async () => {
    const s = store({ data: null as string | null });
    await settleWhen(s.subscribable, () => false, 0);
    expect(s.unsubscribed).toBe(1);
  });

  test("a value arriving after settling does not unsubscribe twice", async () => {
    const s = store({ data: null as string | null });
    await settleWhen(s.subscribable, (v) => v.data !== null, 5);
    s.set({ data: "late" });
    expect(s.unsubscribed).toBe(1);
  });
});
