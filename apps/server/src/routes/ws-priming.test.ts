/**
 * Backfill ordering on the multiplexed socket.
 *
 * The bug this exists to kill is live today on `/ws/statistics`: `open` calls
 * `ws.subscribe(...)` and *then* awaits `todayStatistics(profile)`. Any live
 * frame emitted during that await reaches the client before the snapshot it is
 * supposed to update, so a fresh page can paint newer data and then be
 * overwritten by the older backfill. The same shape lurks on `/ws/automations`.
 *
 * {@link primeTopic} makes it structural rather than a matter of statement
 * order: a topic is "priming" from the moment it is requested until its
 * snapshot has been sent, live frames arriving in that window are buffered on
 * the connection, and only after the snapshot and the buffer have gone out is
 * the connection promoted to the shared pub/sub fan-out.
 *
 * Tested with plain fakes and no mocking at all — every collaborator is a hook
 * on the argument object, which is why this is a pure module rather than three
 * statements inside an Elysia `open` handler.
 */

import { describe, expect, test } from "bun:test";
import { primeTopic } from "./ws-priming";

/**
 * A recording harness: `sent` interleaves snapshot and live frames in delivery
 * order (that ordering *is* the contract), `promotedAt` records where in that
 * sequence the hand-off to pub/sub happened.
 */
function harness(options: {
  snapshot: () => unknown;
  active?: () => boolean;
  withListener?: boolean;
  /** Make one of the delivery hooks fail the way a closing socket does. */
  failSend?: boolean;
  timeoutMs?: number;
  bufferLimit?: number;
}) {
  const sent: string[] = [];
  let promotedAt: number | null = null;
  let detached = false;
  let emit: ((payload: string) => void) | null = null;
  let abandon: (() => void) | null = null;

  const run = primeTopic<unknown, string>({
    timeoutMs: options.timeoutMs,
    bufferLimit: options.bufferLimit,
    onAbandon: (fn) => {
      abandon = fn;
    },
    listen:
      options.withListener === false
        ? undefined
        : (handler) => {
            emit = handler;
            return () => {
              detached = true;
            };
          },
    snapshot: options.snapshot,
    sendSnapshot: (snap) => {
      if (options.failSend) throw new Error("socket is closing");
      sent.push(`snapshot:${String(snap)}`);
    },
    sendLive: (payload) => sent.push(`live:${payload}`),
    promote: () => {
      promotedAt = sent.length;
    },
    isActive: options.active ?? (() => true),
  });

  return {
    run,
    sent,
    /** Push a live payload as the bus would while the snapshot is in flight. */
    emit: (payload: string) => emit?.(payload),
    /** Abandon the run the way the connection's `close` does. */
    abandon: () => abandon?.(),
    get promotedAt() {
      return promotedAt;
    },
    get detached() {
      return detached;
    },
  };
}

/** A snapshot that resolves only once the test says so. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("primeTopic", () => {
  test("a live emit during backfill does not arrive before the snapshot", async () => {
    const snapshot = deferred<string>();
    const h = harness({ snapshot: () => snapshot.promise });

    // The engine ticks while the snapshot query is still running.
    h.emit("tick");
    snapshot.resolve("today");
    await h.run;

    expect(h.sent).toEqual(["snapshot:today", "live:tick"]);
  });

  test("every buffered frame is flushed, in the order it was emitted", async () => {
    const snapshot = deferred<string>();
    const h = harness({ snapshot: () => snapshot.promise });

    h.emit("first");
    h.emit("second");
    snapshot.resolve("today");
    await h.run;

    expect(h.sent).toEqual(["snapshot:today", "live:first", "live:second"]);
  });

  test("the connection joins the shared fan-out only after the backfill has gone out", async () => {
    const snapshot = deferred<string>();
    const h = harness({ snapshot: () => snapshot.promise });

    h.emit("tick");
    expect(h.promotedAt).toBeNull();

    snapshot.resolve("today");
    await h.run;

    // Promoted at index 2: after the snapshot and the one buffered frame.
    expect(h.promotedAt).toBe(2);
  });

  test("the buffering listener is detached once the connection is promoted", async () => {
    // Otherwise every primed topic leaks a bus subscription per connection, and
    // each live frame would be delivered twice — once buffered, once by pub/sub.
    const h = harness({ snapshot: () => "today" });
    await h.run;

    expect(h.detached).toBe(true);
  });

  test("a topic with nothing to backfill is promoted with no snapshot frame", async () => {
    // EVCC can sit idle for minutes with no snapshot yet, and `metrics` has no
    // backfill at all. Neither may be left stuck in the priming state.
    const h = harness({ snapshot: () => undefined });
    await h.run;

    expect(h.sent).toEqual([]);
    expect(h.promotedAt).toBe(0);
  });

  test("a null snapshot counts as nothing to backfill", async () => {
    // `evccSnapshot()` returns `EvccState | null`, not `undefined`.
    const h = harness({ snapshot: () => null });
    await h.run;

    expect(h.sent).toEqual([]);
    expect(h.promotedAt).toBe(0);
  });

  test("a backfill that throws still promotes the connection to the live feed", async () => {
    // A failed snapshot query is a stale first paint; losing the live feed on
    // top of it would be a dead panel until the page is reloaded.
    const h = harness({
      snapshot: () => {
        throw new Error("statistics query failed");
      },
    });
    await h.run;

    expect(h.sent).toEqual([]);
    expect(h.promotedAt).toBe(0);
    expect(h.detached).toBe(true);
  });

  test("a backfill that rejects is treated the same as one that throws", async () => {
    const snapshot = deferred<string>();
    const h = harness({ snapshot: () => snapshot.promise });

    h.emit("tick");
    snapshot.reject(new Error("db down"));
    await h.run;

    // The buffered frame still goes out: it is real data, and the client
    // subscribed for exactly that.
    expect(h.sent).toEqual(["live:tick"]);
    expect(h.promotedAt).toBe(1);
  });

  test("a topic unsubscribed while priming is never promoted and gets no frames", async () => {
    const snapshot = deferred<string>();
    const h = harness({ snapshot: () => snapshot.promise, active: () => false });

    h.emit("tick");
    snapshot.resolve("today");
    await h.run;

    expect(h.sent).toEqual([]);
    expect(h.promotedAt).toBeNull();
    expect(h.detached).toBe(true);
  });

  test("a run abandoned mid-backfill detaches immediately and delivers nothing", async () => {
    // `close` cannot wait for a query that may never return: until the run is
    // abandoned the bus listener stays attached, buffering every emit into an
    // array behind a connection that no longer exists.
    const snapshot = deferred<string>();
    const h = harness({ snapshot: () => snapshot.promise });

    h.emit("tick");
    h.abandon();
    expect(h.detached).toBe(true);

    snapshot.resolve("today");
    expect(await h.run).toBe("abandoned");
    expect(h.sent).toEqual([]);
    expect(h.promotedAt).toBeNull();
  });

  test("a snapshot that never settles is given up on, and the topic still goes live", async () => {
    // A stalled statistics query must cost the client its first paint, not the
    // feed — and must not hold the buffering listener open indefinitely.
    const h = harness({ snapshot: () => new Promise<string>(() => {}), timeoutMs: 5 });

    h.emit("tick");
    expect(await h.run).toBe("promoted");

    expect(h.sent).toEqual(["live:tick"]);
    expect(h.detached).toBe(true);
  });

  test("the live buffer has a ceiling, and it keeps the newest payloads", async () => {
    // Successive states of one feed: when the window overruns, the latest is
    // the one worth having. Unbounded, it is a per-connection leak that a
    // single slow query is enough to trigger.
    const snapshot = deferred<string>();
    const h = harness({ snapshot: () => snapshot.promise, bufferLimit: 2 });

    h.emit("first");
    h.emit("second");
    h.emit("third");
    snapshot.resolve("today");
    await h.run;

    expect(h.sent).toEqual(["snapshot:today", "live:second", "live:third"]);
  });

  test("a delivery that throws is reported, not rejected, and never promotes", async () => {
    // The socket closed between the snapshot resolving and the frame being
    // written. Rejecting would be an unhandled rejection (the caller
    // fire-and-forgets the run); the caller needs the outcome instead, so it
    // can drop the topic and let a re-`sub` retry.
    const h = harness({ snapshot: () => "today", failSend: true });

    expect(await h.run).toBe("failed");
    expect(h.promotedAt).toBeNull();
    expect(h.detached).toBe(true);
  });

  test("a completed run reports that it promoted", async () => {
    const h = harness({ snapshot: () => "today" });
    expect(await h.run).toBe("promoted");
  });

  test("a topic with no live listener still sends its snapshot and promotes", async () => {
    // `logs` opts out of buffering: its ring buffer read is synchronous, so no
    // live line can slip past it.
    const h = harness({ snapshot: () => "ring", withListener: false });
    await h.run;

    expect(h.sent).toEqual(["snapshot:ring"]);
    expect(h.promotedAt).toBe(1);
  });
});
