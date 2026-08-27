/**
 * The scroll-settle admission queue.
 *
 * /history has 63 metric cards and the observer used to wire straight into
 * `visible = true`, so a scroll sweep synchronously BUILT a LayerChart for every
 * card it flew past: 59 mounts and 59 unmounts in a 12s sweep, ~278ms of chart
 * construction each on a preset range. The queue's whole job is that a card you
 * merely passed never builds at all — `cancel()` is the feature, the deferral is
 * the polish.
 *
 * Everything here runs with an injected clock and an injected rAF, so the
 * behaviour is provable under `bun test` with no DOM and no timers.
 */

import { describe, expect, test } from "bun:test";
import { createMountQueue, sharedMountQueue } from "./mount-queue";

/** A hand-cranked rAF: `frame()` runs exactly the callbacks scheduled so far. */
function harness(startAt = 10_000) {
  let time = startAt;
  let nextHandle = 1;
  const pending = new Map<number, () => void>();

  return {
    now: () => time,
    raf: (cb: () => void) => {
      const handle = nextHandle++;
      pending.set(handle, cb);
      return handle;
    },
    cancelRaf: (handle: number) => {
      pending.delete(handle);
    },
    /** Advance the clock without running a frame. */
    advance(ms: number) {
      time += ms;
    },
    /** Run one animation frame — the callbacks queued before it, and only those. */
    frame(ms = 16) {
      time += ms;
      const due = [...pending.entries()];
      pending.clear();
      for (const [, cb] of due) cb();
    },
    get scheduled() {
      return pending.size;
    },
  };
}

const queueWith = (h: ReturnType<typeof harness>, overrides = {}) =>
  createMountQueue({ now: h.now, raf: h.raf, cancelRaf: h.cancelRaf, ...overrides });

describe("createMountQueue — cancellation", () => {
  test("a cancelled request NEVER runs, however long the page then sits quiet", () => {
    // THE feature: a card the sweep flew past must not pay for a chart build.
    const h = harness();
    const queue = queueWith(h);
    const ran: string[] = [];

    queue.noteScroll();
    queue.request("a", () => ran.push("a"));
    queue.request("b", () => ran.push("b"));
    queue.cancel("a");

    h.advance(1000);
    for (let i = 0; i < 20; i++) h.frame();

    expect(ran).toEqual(["b"]);
  });

  test("cancelling every parked request leaves nothing to run and stops the loop", () => {
    const h = harness();
    const queue = queueWith(h);
    let ran = 0;

    queue.request("a", () => ran++);
    queue.request("b", () => ran++);
    queue.cancel("a");
    queue.cancel("b");

    for (let i = 0; i < 5; i++) h.frame();
    expect(ran).toBe(0);
    expect(h.scheduled).toBe(0);
  });

  test("cancelling an unknown id, or one already run, is a no-op", () => {
    const h = harness();
    const queue = queueWith(h);
    let ran = 0;

    queue.request("a", () => ran++);
    h.frame();
    expect(ran).toBe(1);

    expect(() => queue.cancel("a")).not.toThrow();
    expect(() => queue.cancel("never-seen")).not.toThrow();
    for (let i = 0; i < 3; i++) h.frame();
    expect(ran).toBe(1);
  });

  test("a cancelled id can be requested again and then runs", () => {
    // Scrolling back to a card you flew past must still build it.
    const h = harness();
    const queue = queueWith(h);
    const ran: string[] = [];

    queue.request("a", () => ran.push("first"));
    queue.cancel("a");
    queue.request("a", () => ran.push("second"));
    h.frame();

    expect(ran).toEqual(["second"]);
  });
});

describe("createMountQueue — quiet-window admission", () => {
  test("parks work while the page is still scrolling", () => {
    const h = harness();
    const queue = queueWith(h, { quietMs: 160 });
    let ran = 0;

    queue.request("a", () => ran++);
    queue.noteScroll();
    h.frame(16);
    h.frame(16);
    h.frame(16);

    // 48ms of quiet is not 160ms.
    expect(ran).toBe(0);
    // …and it is still watching for the settle, not given up.
    expect(h.scheduled).toBe(1);
  });

  test("runs once the scroll has been quiet for quietMs", () => {
    const h = harness();
    const queue = queueWith(h, { quietMs: 160 });
    let ran = 0;

    queue.noteScroll();
    queue.request("a", () => ran++);
    h.advance(200);
    h.frame(0);

    expect(ran).toBe(1);
  });

  test("a fresh queue that has never scrolled admits on the first frame", () => {
    // First paint must not wait 160ms for a scroll that never happened.
    const h = harness();
    const queue = queueWith(h, { quietMs: 160 });
    let ran = 0;

    queue.request("a", () => ran++);
    h.frame();
    expect(ran).toBe(1);
  });

  test("noteScroll mid-drain defers everything still parked", () => {
    const h = harness();
    const queue = queueWith(h, { quietMs: 160, perFrame: 5 });
    const ran: string[] = [];

    // The first callback scrolls the page; the rest of this frame's budget
    // must not be spent.
    queue.request("a", () => {
      ran.push("a");
      queue.noteScroll();
    });
    queue.request("b", () => ran.push("b"));
    queue.request("c", () => ran.push("c"));

    h.frame();
    expect(ran).toEqual(["a"]);

    // Still scrolling: nothing more.
    h.frame(16);
    expect(ran).toEqual(["a"]);

    // Settled: the remainder drains.
    h.advance(200);
    h.frame(0);
    expect(ran).toEqual(["a", "b", "c"]);
  });

  test("noteScroll before any request still delays that request", () => {
    const h = harness();
    const queue = queueWith(h, { quietMs: 160 });
    let ran = 0;

    queue.noteScroll();
    h.advance(100);
    queue.request("a", () => ran++);
    h.frame(0);
    expect(ran).toBe(0);

    h.advance(100);
    h.frame(0);
    expect(ran).toBe(1);
  });
});

describe("createMountQueue — drain rate and ordering", () => {
  test("admits at most perFrame per frame, in the order the cards were entered", () => {
    const h = harness();
    const queue = queueWith(h, { quietMs: 0, perFrame: 2 });
    const ran: string[] = [];

    for (const id of ["a", "b", "c", "d", "e"]) queue.request(id, () => ran.push(id));

    h.frame();
    expect(ran).toEqual(["a", "b"]);
    h.frame();
    expect(ran).toEqual(["a", "b", "c", "d"]);
    h.frame();
    expect(ran).toEqual(["a", "b", "c", "d", "e"]);

    // Drained: the rAF loop stops rather than spinning forever.
    expect(h.scheduled).toBe(0);
  });

  test("defaults to one mount per frame", () => {
    const h = harness();
    const queue = queueWith(h);
    const ran: string[] = [];

    for (const id of ["a", "b", "c"]) queue.request(id, () => ran.push(id));
    h.frame();
    expect(ran).toEqual(["a"]);
    h.frame();
    expect(ran).toEqual(["a", "b"]);
  });

  test("re-requesting a parked id does not double-run it, and keeps its place", () => {
    // The observer can fire enter twice for one card across a jittery sweep.
    const h = harness();
    const queue = queueWith(h, { quietMs: 0, perFrame: 1 });
    const ran: string[] = [];

    queue.request("a", () => ran.push("a1"));
    queue.request("b", () => ran.push("b"));
    queue.request("a", () => ran.push("a2"));

    h.frame();
    h.frame();
    h.frame();

    // One run for "a" — the latest callback — and it did not jump behind "b".
    expect(ran).toEqual(["a2", "b"]);
  });

  test("requesting while a frame is already scheduled does not stack rAF loops", () => {
    const h = harness();
    const queue = queueWith(h, { quietMs: 0, perFrame: 1 });

    queue.request("a", () => {});
    queue.request("b", () => {});
    queue.request("c", () => {});
    expect(h.scheduled).toBe(1);
  });

  test("an empty queue schedules nothing at all", () => {
    const h = harness();
    const queue = queueWith(h, { quietMs: 0 });
    queue.noteScroll();
    expect(h.scheduled).toBe(0);
  });
});

describe("sharedMountQueue", () => {
  test("is one queue for the whole grid, subscribed to scroll exactly once", () => {
    // Per-card queues would each get their own per-frame budget, which is no
    // budget at all — 63 cards would admit 63 mounts in one frame.
    const real = globalThis.addEventListener;
    const registered: { type: string; options: unknown }[] = [];
    globalThis.addEventListener = ((type: string, _fn: unknown, options: unknown) => {
      registered.push({ type, options });
    }) as typeof globalThis.addEventListener;
    try {
      const first = sharedMountQueue();
      const second = sharedMountQueue();
      expect(second).toBe(first);
      // Capture phase, because the page scrolls inside `main`, not on window.
      expect(registered).toEqual([{ type: "scroll", options: { capture: true, passive: true } }]);
    } finally {
      globalThis.addEventListener = real;
    }
  });
});
