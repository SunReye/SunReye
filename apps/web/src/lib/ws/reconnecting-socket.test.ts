import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  ReconnectingSocket,
  type ReconnectingSocketHooks,
  type SocketLike,
} from "./reconnecting-socket";

/** A socket that records what happened to it and lets a test fire its events. */
class FakeSocket implements SocketLike {
  closed = 0;
  #handlers = new Map<string, () => void>();
  #message: ((message: { data: unknown }) => void) | null = null;

  subscribe(handler: (message: { data: unknown }) => void): void {
    this.#message = handler;
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

  test("ignores messages from a superseded socket", () => {
    const { socket, sockets, seen } = harness();
    const release = socket.connect();
    sockets[0]?.push("live");
    release();
    sockets[0]?.push("late");
    expect(seen).toEqual(["live"]);
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
    onStart: () => events.push("start"),
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
