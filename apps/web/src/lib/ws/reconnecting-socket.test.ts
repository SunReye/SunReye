import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  ReconnectingSocket,
  type ReconnectingSocketHooks,
  type SocketLike,
} from "./reconnecting-socket";

/** A socket that records what happened to it and lets a test fire its events. */
class FakeSocket implements SocketLike {
  closed = 0;
  /** Frames written to this socket, in order. */
  sent: string[] = [];
  #handlers = new Map<string, () => void>();
  #message: ((message: { data: unknown }) => void) | null = null;

  subscribe(handler: (message: { data: unknown }) => void): void {
    this.#message = handler;
  }
  send(data: string): void {
    this.sent.push(data);
  }
  on(event: "open" | "close" | "error", handler: () => void): void {
    this.#handlers.set(event, handler);
  }
  close(): void {
    this.closed += 1;
  }
  emit(event: "open" | "close" | "error"): void {
    this.#handlers.get(event)?.();
  }
  push(data: unknown): void {
    this.#message?.({ data });
  }
}

function harness() {
  const sockets: FakeSocket[] = [];
  const seen: unknown[] = [];
  const socket = new ReconnectingSocket({
    create: () => {
      const ws = new FakeSocket();
      sockets.push(ws);
      return ws;
    },
    onMessage: (data) => seen.push(data),
  });
  return { socket, sockets, seen };
}

describe("ReconnectingSocket", () => {
  test("opens on the first lease and shares it with the rest", () => {
    const { socket, sockets } = harness();
    const a = socket.connect();
    const b = socket.connect();
    expect(sockets).toHaveLength(1);
    a();
    // One lease still live: the connection stays up.
    expect(sockets[0]?.closed).toBe(0);
    b();
    expect(sockets[0]?.closed).toBe(1);
  });

  test("closes for good when the last lease goes away", async () => {
    // The page releases its lease when the picked range stops including now; a
    // leaked lease would keep the server's periodic job publishing for nobody.
    const { socket, sockets } = harness();
    const release = socket.connect();
    release();
    expect(sockets[0]?.closed).toBe(1);
    // A close event on the released socket must not reopen anything.
    sockets[0]?.emit("close");
    await Bun.sleep(1200);
    expect(sockets).toHaveLength(1);
  });

  test("a disposer run twice gives back one lease, not two", () => {
    // A Svelte cleanup can run twice (a teardown after an explicit release). An
    // unguarded disposer would drive the refcount negative, and `connect()`'s
    // "first lease opens" test would never be true again: the page keeps its
    // dashboard, silently, with no socket behind it for the rest of its life.
    const { socket, sockets } = harness();
    const release = socket.connect();
    release();
    release();
    socket.connect();
    expect(sockets).toHaveLength(2);
  });

  test("ignores messages from a superseded socket", () => {
    const { socket, sockets, seen } = harness();
    const release = socket.connect();
    sockets[0]?.push("live");
    release();
    sockets[0]?.push("late");
    expect(seen).toEqual(["live"]);
  });
});

// --- Asynchronous start ---------------------------------------------------------
//
// The metrics store backfills the offline gap over HTTP before each (re)connect.
// That backfill is a promise, and the socket must not exist until it settles: a
// live sample landing mid-backfill would be overwritten by the older rows the
// fetch is still carrying.

/** A deferred the test resolves by hand, standing in for the backfill fetch. */
function deferred(): { promise: Promise<void>; resolve: () => void; reject: () => void } {
  let resolve!: () => void;
  let reject!: () => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = () => rej(new Error("backfill failed"));
  });
  return { promise, resolve, reject };
}

describe("ReconnectingSocket with an asynchronous onStart", () => {
  test("holds the socket back until the backfill settles", async () => {
    const backfill = deferred();
    const sockets: FakeSocket[] = [];
    const socket = new ReconnectingSocket({
      create: () => {
        const ws = new FakeSocket();
        sockets.push(ws);
        return ws;
      },
      onMessage: () => {},
      onStart: () => backfill.promise,
    });
    socket.connect();
    expect(sockets).toHaveLength(0);
    backfill.resolve();
    await backfill.promise;
    expect(sockets).toHaveLength(1);
  });

  test("a backfill that fails still opens the stream", async () => {
    // The history endpoint being down is a gap in the sparklines, not a reason
    // to leave the dashboard with no live feed at all.
    const backfill = deferred();
    const sockets: FakeSocket[] = [];
    const socket = new ReconnectingSocket({
      create: () => {
        const ws = new FakeSocket();
        sockets.push(ws);
        return ws;
      },
      onMessage: () => {},
      onStart: () => backfill.promise,
    });
    socket.connect();
    backfill.reject();
    await backfill.promise.catch(() => {});
    await Bun.sleep(0);
    expect(sockets).toHaveLength(1);
  });

  test("a lease released mid-backfill never opens a socket", async () => {
    // The tab hid while the backfill was in flight; opening afterwards would
    // leave exactly the buffered 1 Hz backlog the hide is there to avoid.
    const backfill = deferred();
    const sockets: FakeSocket[] = [];
    const socket = new ReconnectingSocket({
      create: () => {
        const ws = new FakeSocket();
        sockets.push(ws);
        return ws;
      },
      onMessage: () => {},
      onStart: () => backfill.promise,
    });
    const release = socket.connect();
    release();
    backfill.resolve();
    await backfill.promise;
    expect(sockets).toHaveLength(0);
  });

  test("a start still wanted when its backfill settles is told so", async () => {
    const backfill = deferred();
    const wanted: boolean[] = [];
    const socket = new ReconnectingSocket({
      create: () => new FakeSocket(),
      onMessage: () => {},
      onStart: async (stillWanted) => {
        await backfill.promise;
        wanted.push(stillWanted());
      },
    });
    socket.connect();
    backfill.resolve();
    await backfill.promise;
    await Bun.sleep(0);
    expect(wanted).toEqual([true]);
  });

  test("an abandoned start is told so, so it cannot write state after the fact", async () => {
    // The tab hides (or the store stops) while the backfill fetch is in flight.
    // The socket abandons the attempt, but the hook's own async body runs to
    // completion regardless — without this signal it publishes "connecting" on
    // a store that has no socket, no lease and no armed reconnect.
    const backfill = deferred();
    const wanted: boolean[] = [];
    const sockets: FakeSocket[] = [];
    const socket = new ReconnectingSocket({
      create: () => {
        const ws = new FakeSocket();
        sockets.push(ws);
        return ws;
      },
      onMessage: () => {},
      onStart: async (stillWanted) => {
        await backfill.promise;
        wanted.push(stillWanted());
      },
    });
    const release = socket.connect();
    release();
    backfill.resolve();
    await backfill.promise;
    await Bun.sleep(0);
    expect(wanted).toEqual([false]);
    expect(sockets).toHaveLength(0);
  });

  test("a start superseded by a reopen is told so", async () => {
    // Hide-then-show inside one backfill: the first attempt still has a live
    // lease, but it is not the attempt that owns the connection any more.
    const backfills = [deferred(), deferred()];
    let started = 0;
    const wanted: boolean[] = [];
    const socket = new ReconnectingSocket({
      create: () => new FakeSocket(),
      onMessage: () => {},
      onStart: async (stillWanted) => {
        const mine = backfills[started++];
        await mine?.promise;
        wanted.push(stillWanted());
      },
    });
    const release = socket.connect();
    release();
    socket.connect();
    backfills[0]?.resolve();
    backfills[1]?.resolve();
    await Promise.all(backfills.map((b) => b.promise));
    await Bun.sleep(0);
    expect(wanted).toEqual([false, true]);
  });

  test("a fresh lease during an in-flight backfill supersedes it", async () => {
    // Hide-then-show inside one backfill: the abandoned start must not open a
    // second socket alongside the one the new lease is waiting for.
    const backfills = [deferred(), deferred()];
    let started = 0;
    const sockets: FakeSocket[] = [];
    const socket = new ReconnectingSocket({
      create: () => {
        const ws = new FakeSocket();
        sockets.push(ws);
        return ws;
      },
      onMessage: () => {},
      onStart: () => backfills[started++]?.promise,
    });
    const release = socket.connect();
    release();
    socket.connect();
    backfills[0]?.resolve();
    backfills[1]?.resolve();
    await Promise.all(backfills.map((b) => b.promise));
    await Bun.sleep(0);
    expect(started).toBe(2);
    expect(sockets).toHaveLength(1);
  });
});

// --- Reconnect ------------------------------------------------------------------
//
// The reconnect path is a clock plus an identity check, so the tests below drive a
// fake clock (no wall-clock waiting for a 15 s backoff) and a socket that behaves
// like the transport: closing it fires `close`, the way the browser does.

/** A socket that, like a real WebSocket, reports its own close exactly once. */
class LiveSocket extends FakeSocket {
  override close(): void {
    const first = this.closed === 0;
    super.close();
    if (first) this.emit("close");
  }
}

interface ArmedTimer {
  delayMs: number;
  run: () => void;
  cancelled: boolean;
  fired: boolean;
}

const realSetTimeout = globalThis.setTimeout;
const realClearTimeout = globalThis.clearTimeout;
let armed: ArmedTimer[] = [];

function installFakeTimers(): void {
  globalThis.setTimeout = ((fn: () => void, delayMs = 0) => {
    const entry: ArmedTimer = { delayMs, run: fn, cancelled: false, fired: false };
    armed.push(entry);
    return entry as unknown as ReturnType<typeof setTimeout>;
  }) as unknown as typeof setTimeout;
  globalThis.clearTimeout = ((handle: unknown) => {
    if (handle !== null && typeof handle === "object" && "cancelled" in handle) {
      (handle as ArmedTimer).cancelled = true;
      return;
    }
    realClearTimeout(handle as Parameters<typeof clearTimeout>[0]);
  }) as unknown as typeof clearTimeout;
}

/** Reconnects still waiting to fire — the socket arms at most one at a time. */
const pending = (): ArmedTimer[] => armed.filter((a) => !a.cancelled && !a.fired);

function last<T>(items: readonly T[]): T {
  const item = items.at(-1);
  if (item === undefined) throw new Error("expected at least one entry");
  return item;
}

/** Strict index — `sockets[i]?.emit(...)` would silently no-op a missing socket. */
function nth<T>(items: readonly T[], index: number): T {
  const item = items[index];
  if (item === undefined) throw new Error(`expected a socket at index ${index}`);
  return item;
}

/** Let the armed reconnect run, as the clock would. */
function elapse(): void {
  const next = last(pending());
  next.fired = true;
  next.run();
}

interface LiveHarness {
  socket: ReconnectingSocket;
  sockets: LiveSocket[];
  seen: unknown[];
  /**
   * Lifecycle hook calls in order — the stores' view of the connection. `create`
   * is logged alongside them so the *relative order* of the hooks and the socket
   * construction is pinned, not just the hook sequence.
   */
  events: string[];
}

function liveHarness(extra: Partial<ReconnectingSocketHooks> = {}): LiveHarness {
  const sockets: LiveSocket[] = [];
  const seen: unknown[] = [];
  const events: string[] = [];
  const socket = new ReconnectingSocket({
    create: () => {
      events.push("create");
      const ws = new LiveSocket();
      sockets.push(ws);
      return ws;
    },
    onMessage: (data) => seen.push(data),
    onStart: () => {
      events.push("start");
    },
    onOpen: () => events.push("open"),
    onDrop: () => events.push("drop"),
    ...extra,
  });
  return { socket, sockets, seen, events };
}

/** Drop the live socket `count` times, reconnecting each time; yields the waits. */
function waitsAfterRepeatedDrops(h: LiveHarness, count: number): number[] {
  const delays: number[] = [];
  for (let i = 0; i < count; i += 1) {
    last(h.sockets).emit("close");
    delays.push(last(pending()).delayMs);
    elapse();
  }
  return delays;
}

describe("ReconnectingSocket after an unexpected drop", () => {
  beforeEach(() => {
    armed = [];
    installFakeTimers();
  });

  afterEach(() => {
    globalThis.setTimeout = realSetTimeout;
    globalThis.clearTimeout = realClearTimeout;
  });

  test("waits a second before the first retry and doubles the wait for each failure", () => {
    // A server restart is back in a second; a server that is down should not be
    // hammered by every open dashboard tab.
    const h = liveHarness();
    h.socket.connect();
    expect(waitsAfterRepeatedDrops(h, 4)).toEqual([1000, 2000, 4000, 8000]);
    // One socket per attempt: the original plus the four reopens.
    expect(h.sockets).toHaveLength(5);
  });

  test("never waits longer than fifteen seconds, however long the server stays down", () => {
    // Doubling past the cap would leave a tab silent for minutes after the
    // server came back — the dashboard has to notice within one glance.
    const h = liveHarness();
    h.socket.connect();
    expect(waitsAfterRepeatedDrops(h, 7)).toEqual([1000, 2000, 4000, 8000, 15_000, 15_000, 15_000]);
  });

  test("a completed handshake earns a fresh one-second backoff", () => {
    const h = liveHarness();
    h.socket.connect();
    expect(waitsAfterRepeatedDrops(h, 3)).toEqual([1000, 2000, 4000]);
    last(h.sockets).emit("open");
    // This drop follows a connection that actually worked, so the next outage
    // starts over rather than inheriting the previous one's penalty.
    expect(waitsAfterRepeatedDrops(h, 1)).toEqual([1000]);
  });

  test("a handshake completing on an abandoned socket does not clear the backoff", () => {
    const h = liveHarness();
    h.socket.connect();
    expect(waitsAfterRepeatedDrops(h, 2)).toEqual([1000, 2000]);
    nth(h.sockets, 0).emit("open");
    // The late handshake is swallowed: no `open` hook fires for it.
    expect(h.events).toEqual([
      "start",
      "create",
      "drop",
      "start",
      "create",
      "drop",
      "start",
      "create",
    ]);
    expect(waitsAfterRepeatedDrops(h, 1)).toEqual([4000]);
  });

  test("a transport error is retried like a drop", () => {
    // A refused or half-open connection surfaces as `error`, never `close`; it
    // has to reach the same single reconnect path or the stream dies silently.
    const h = liveHarness();
    h.socket.connect();
    last(h.sockets).emit("error");
    expect(last(h.sockets).closed).toBe(1);
    expect(h.events).toEqual(["start", "create", "drop"]);
    expect(last(pending()).delayMs).toBe(1000);
    elapse();
    expect(h.sockets).toHaveLength(2);
    expect(h.events).toEqual(["start", "create", "drop", "start", "create"]);
  });

  test("an error on an abandoned socket closes only that socket", () => {
    const h = liveHarness();
    h.socket.connect();
    waitsAfterRepeatedDrops(h, 1);
    const abandoned = nth(h.sockets, 0);
    abandoned.emit("error");
    expect(abandoned.closed).toBe(1);
    // No second reconnect queued, and the live socket is untouched.
    expect(pending()).toHaveLength(0);
    expect(h.sockets).toHaveLength(2);
    expect(last(h.sockets).closed).toBe(0);
  });

  test("per-connection state is reset before each reopen, not after it", () => {
    // EVCC backfills the offline gap in onStart; running it after `create` would
    // race the first live push and let a stale sample win. So `start` has to land
    // before the socket exists, on the reopen as much as on the first open.
    const h = liveHarness();
    h.socket.connect();
    expect(h.events).toEqual(["start", "create"]);
    last(h.sockets).emit("open");
    last(h.sockets).emit("close");
    elapse();
    last(h.sockets).emit("open");
    expect(h.events).toEqual(["start", "create", "open", "drop", "start", "create", "open"]);
  });

  test("a lease taken while a reconnect is pending joins the pending connection", () => {
    const h = liveHarness();
    h.socket.connect();
    last(h.sockets).emit("close");
    h.socket.connect();
    expect(h.sockets).toHaveLength(1);
    expect(pending()).toHaveLength(1);
    elapse();
    expect(h.sockets).toHaveLength(2);
  });

  test("releasing the last lease cancels a reconnect that was already armed", () => {
    // The panel is gone; reopening for nobody keeps the server's publisher busy.
    const h = liveHarness();
    const release = h.socket.connect();
    last(h.sockets).emit("close");
    expect(pending()).toHaveLength(1);
    release();
    expect(pending()).toHaveLength(0);
    expect(h.sockets).toHaveLength(1);
  });

  test("a consumer that unmounts while handling the drop is not reconnected", () => {
    // The drop hook is what flips `connected` false, and a component may react by
    // tearing itself down inside that same call.
    let release: (() => void) | null = null;
    const h = liveHarness({
      onDrop: () => {
        const pendingRelease = release;
        release = null; // a cleanup runs once
        pendingRelease?.();
      },
    });
    release = h.socket.connect();
    last(h.sockets).emit("close");
    expect(pending()).toHaveLength(0);
    expect(h.sockets).toHaveLength(1);
  });

  test("a fresh lease after teardown starts over from a one-second backoff", () => {
    const h = liveHarness();
    const release = h.socket.connect();
    expect(waitsAfterRepeatedDrops(h, 3)).toEqual([1000, 2000, 4000]);
    release();
    expect(last(h.sockets).closed).toBe(1);

    h.socket.connect();
    expect(h.sockets).toHaveLength(5);
    expect(waitsAfterRepeatedDrops(h, 1)).toEqual([1000]);
  });

  test("a late flush from the pre-reconnect socket cannot reach the store", () => {
    // The dropped socket may still deliver a buffered frame after the reopen; it
    // carries pre-outage values that would overwrite the fresh ones.
    const h = liveHarness();
    h.socket.connect();
    const stale = last(h.sockets);
    stale.push("before the drop");
    waitsAfterRepeatedDrops(h, 1);
    stale.push("buffered during the outage");
    last(h.sockets).push("after the reconnect");
    expect(h.seen).toEqual(["before the drop", "after the reconnect"]);
  });

  test("zero, an empty string and null are messages, not missing payloads", () => {
    // 0 W is a reading and an empty frame is a frame; only the sender's identity
    // decides whether a message counts.
    const h = liveHarness();
    h.socket.connect();
    for (const payload of [0, "", null, false, { power: -250 }]) last(h.sockets).push(payload);
    expect(h.seen).toEqual([0, "", null, false, { power: -250 }]);
  });

  test("the connection stays down after teardown even if the socket reports its close", () => {
    const h = liveHarness();
    const release = h.socket.connect();
    last(h.sockets).emit("open");
    release();
    // `close()` on a live socket fires `close`; the released socket must not
    // reach the reconnect path through it.
    expect(h.events).toEqual(["start", "create", "open", "drop"]);
    expect(pending()).toHaveLength(0);
    expect(h.sockets).toHaveLength(1);
  });
});

// --- Writing to the socket ------------------------------------------------------
//
// The multiplexed live socket is the first consumer that talks *back*: it sends
// `{ t: "sub", … }` frames to say which topics it wants. Those frames are written
// the moment a component subscribes, which is routinely before the handshake has
// finished — a browser WebSocket throws on a send in CONNECTING, so the queue is
// what makes "subscribe whenever you like" safe.

describe("ReconnectingSocket.send", () => {
  beforeEach(() => {
    armed = [];
    installFakeTimers();
  });

  afterEach(() => {
    globalThis.setTimeout = realSetTimeout;
    globalThis.clearTimeout = realClearTimeout;
  });

  test("send() before open is queued and flushed on open", () => {
    const h = liveHarness();
    h.socket.connect();
    h.socket.send("first");
    h.socket.send("second");
    // The socket exists but has not shaken hands: nothing may go out yet.
    expect(last(h.sockets).sent).toEqual([]);
    last(h.sockets).emit("open");
    // Flushed in the order they were written — a sub and the unsub that follows
    // it must not swap places.
    expect(last(h.sockets).sent).toEqual(["first", "second"]);
  });

  test("a send after the handshake goes straight out", () => {
    const h = liveHarness();
    h.socket.connect();
    last(h.sockets).emit("open");
    h.socket.send("live");
    expect(last(h.sockets).sent).toEqual(["live"]);
  });

  test("the queue is flushed before the open hook runs", () => {
    // The consumer's `onOpen` reconciles its subscriptions against what it has
    // already told this socket. If the queue drained afterwards, that
    // reconciliation would see an empty socket and write the same frames twice.
    const events: string[] = [];
    const h = liveHarness({
      onOpen: () => events.push(`open:${last(h.sockets).sent.join(",")}`),
    });
    h.socket.connect();
    h.socket.send("queued");
    last(h.sockets).emit("open");
    expect(events).toEqual(["open:queued"]);
  });

  test("a frame queued on a socket that dropped before opening is not replayed on the next one", () => {
    // A frame belongs to the connection it was written for. The consumer clears
    // its own bookkeeping on the drop and rewrites whatever is still wanted, so
    // replaying the old frame would double it.
    const h = liveHarness();
    h.socket.connect();
    h.socket.send("for the dead socket");
    last(h.sockets).emit("close");
    elapse();
    last(h.sockets).emit("open");
    expect(h.sockets).toHaveLength(2);
    expect(last(h.sockets).sent).toEqual([]);
  });

  test("a frame written from onDrop at teardown survives into the next connection", () => {
    // `onDrop` is where a consumer reconciles what it told the connection that
    // just died; anything it writes from there is meant for the *next* one. The
    // last lease going away while the socket was live must not be the one case
    // where that frame is silently swallowed.
    const h: LiveHarness = liveHarness({
      onDrop: () => h.socket.send("written from the drop hook"),
    });
    const release = h.socket.connect();
    last(h.sockets).emit("open"); // a live socket at teardown
    release();

    h.socket.connect();
    expect(h.sockets).toHaveLength(2);
    last(h.sockets).emit("open");
    expect(last(h.sockets).sent).toEqual(["written from the drop hook"]);
  });

  test("a frame written from onDrop at teardown survives when the connection was already down", () => {
    // The same invariant on the other teardown path: the lease went away mid-
    // outage, so there is no socket left to close. Both paths must agree.
    const h: LiveHarness = liveHarness({
      onDrop: () => h.socket.send("written from the drop hook"),
    });
    const release = h.socket.connect();
    last(h.sockets).emit("close"); // drop hook writes once, for the reconnect
    release(); // ... and once more for whatever lease comes next

    h.socket.connect();
    expect(h.sockets).toHaveLength(2);
    last(h.sockets).emit("open");
    expect(last(h.sockets).sent).toEqual(["written from the drop hook"]);
  });

  test("a send while the connection is down is queued for the socket that replaces it", () => {
    // The tab is subscribing to a topic mid-outage. Dropping the frame would
    // leave the topic silent until something else forced a resubscribe.
    const h = liveHarness();
    h.socket.connect();
    last(h.sockets).emit("close");
    h.socket.send("written during the outage");
    elapse();
    expect(last(h.sockets).sent).toEqual([]);
    last(h.sockets).emit("open");
    expect(last(h.sockets).sent).toEqual(["written during the outage"]);
  });
});
