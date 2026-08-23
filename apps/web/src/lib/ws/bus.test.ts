import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { ClientFrame } from "@SunReye/contracts/ws";
import { LiveBus } from "./bus";
import type { SocketLike } from "./reconnecting-socket";

/**
 * A socket that records the frames written to it and lets a test fire its
 * events. Like the browser's, `close()` reports itself.
 */
class FakeSocket implements SocketLike {
  closed = 0;
  sent: string[] = [];
  #handlers = new Map<string, () => void>();
  #message: ((message: { data: unknown }) => void) | null = null;

  subscribe(handler: (message: { data: unknown }) => void): void {
    this.#message = handler;
  }
  on(event: "open" | "close" | "error", handler: () => void): void {
    this.#handlers.set(event, handler);
  }
  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    const first = this.closed === 0;
    this.closed += 1;
    if (first) this.#handlers.get("close")?.();
  }
  emit(event: "open" | "close" | "error"): void {
    this.#handlers.get(event)?.();
  }
  /** Deliver a frame the way the transport does — as the raw JSON text. */
  push(data: unknown): void {
    this.#message?.({ data });
  }
  /** The control frames this socket was asked to send, parsed. */
  frames(): ClientFrame[] {
    return this.sent.map((raw) => JSON.parse(raw) as ClientFrame);
  }
}

// The reconnect backoff is a real timer; drive it by hand so a test never waits.
interface ArmedTimer {
  run: () => void;
  cancelled: boolean;
  fired: boolean;
}
const realSetTimeout = globalThis.setTimeout;
const realClearTimeout = globalThis.clearTimeout;
let armed: ArmedTimer[] = [];

function installFakeTimers(): void {
  armed = [];
  globalThis.setTimeout = ((fn: () => void) => {
    const entry: ArmedTimer = { run: fn, cancelled: false, fired: false };
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

/** Let the armed reconnect run, as the clock would. */
function elapse(): void {
  const next = armed.filter((a) => !a.cancelled && !a.fired).at(-1);
  if (!next) throw new Error("expected a reconnect to be armed");
  next.fired = true;
  next.run();
}

interface Harness {
  bus: LiveBus;
  sockets: FakeSocket[];
  connected: boolean[];
  cadence: number[];
  /** Advance the injected arrival clock (ms) — the cadence EMA reads it. */
  tick(ms: number): void;
}

function harness(): Harness {
  const sockets: FakeSocket[] = [];
  const connected: boolean[] = [];
  const cadence: number[] = [];
  let clock = 0;
  const bus = new LiveBus({
    create: () => {
      const ws = new FakeSocket();
      sockets.push(ws);
      return ws;
    },
    onConnected: (value) => connected.push(value),
    onCadence: (ms) => cadence.push(ms),
    now: () => clock,
  });
  return {
    bus,
    sockets,
    connected,
    cadence,
    tick: (ms) => {
      clock += ms;
    },
  };
}

/** Strict index — `sockets[i]?.emit(...)` would silently no-op a missing socket. */
function nth<T>(items: readonly T[], index: number): T {
  const item = items[index];
  if (item === undefined) throw new Error(`expected an entry at index ${index}`);
  return item;
}

const last = <T>(items: readonly T[]): T => nth(items, items.length - 1);

/** Open the socket the shell's lease created, and hand back the release. */
function openConnection(h: Harness): () => void {
  const release = h.bus.connect();
  last(h.sockets).emit("open");
  return release;
}

describe("LiveBus", () => {
  beforeEach(installFakeTimers);
  afterEach(() => {
    globalThis.setTimeout = realSetTimeout;
    globalThis.clearTimeout = realClearTimeout;
  });

  test("the first subscriber of a topic sends one sub frame; the second sends none", () => {
    // The server tracks a topic per connection, not per component. Two cards
    // reading the same feed must cost one frame, or the second one re-primes a
    // backfill the first already has.
    const h = harness();
    openConnection(h);
    h.bus.subscribe("metrics", () => {});
    expect(last(h.sockets).frames()).toEqual([{ t: "sub", topics: ["metrics"] }]);
    h.bus.subscribe("metrics", () => {});
    expect(last(h.sockets).frames()).toEqual([{ t: "sub", topics: ["metrics"] }]);
  });

  test("the last unsubscribe sends unsub but never closes the socket", () => {
    // The socket's own lease belongs to the app shell. If topic refcounting
    // shared it, navigating away from the only page reading a feed would tear
    // down the whole connection and every other topic with it.
    const h = harness();
    openConnection(h);
    const first = h.bus.subscribe("metrics", () => {});
    const second = h.bus.subscribe("metrics", () => {});
    first();
    expect(last(h.sockets).frames()).toEqual([{ t: "sub", topics: ["metrics"] }]);
    second();
    expect(last(h.sockets).frames()).toEqual([
      { t: "sub", topics: ["metrics"] },
      { t: "unsub", topics: ["metrics"] },
    ]);
    expect(last(h.sockets).closed).toBe(0);
    expect(h.sockets).toHaveLength(1);
  });

  test("a reconnect replays every held topic in exactly one sub frame", () => {
    // No store participates in reconnection: the bus is the only thing that
    // remembers what this connection wanted, so a second frame here means a
    // topic got primed twice.
    const h = harness();
    openConnection(h);
    h.bus.subscribe("metrics", () => {});
    h.bus.subscribe("evcc", () => {});
    last(h.sockets).emit("close");
    elapse();
    expect(h.sockets).toHaveLength(2);
    expect(last(h.sockets).frames()).toEqual([]);
    last(h.sockets).emit("open");
    expect(last(h.sockets).frames()).toEqual([{ t: "sub", topics: ["metrics", "evcc"] }]);
  });

  test("a topic dropped during an outage is not resubscribed by the replay", () => {
    const h = harness();
    openConnection(h);
    h.bus.subscribe("metrics", () => {});
    const release = h.bus.subscribe("evcc", () => {});
    last(h.sockets).emit("close");
    release();
    elapse();
    last(h.sockets).emit("open");
    expect(last(h.sockets).frames()).toEqual([{ t: "sub", topics: ["metrics"] }]);
  });

  test("a frame for a topic nobody holds calls no handler", () => {
    // The server may still be flushing frames between our unsub and its
    // processing of it, and the ack frame rides the same connection.
    const h = harness();
    openConnection(h);
    const seen: unknown[] = [];
    const release = h.bus.subscribe("evcc", (data) => seen.push(data));
    release();
    last(h.sockets).push(JSON.stringify({ topic: "evcc", data: { chargers: [] } }));
    last(h.sockets).push(JSON.stringify({ topic: "__ack", data: { subscribed: [], denied: [] } }));
    last(h.sockets).push(JSON.stringify({ topic: "nonsense", data: 1 }));
    expect(seen).toEqual([]);
  });

  test("a sub issued before open is queued and flushed on open", () => {
    // A page's `$effect` runs the moment it mounts, which is long before the
    // handshake finishes on a cold load.
    const h = harness();
    h.bus.connect();
    h.bus.subscribe("statistics", () => {});
    expect(last(h.sockets).frames()).toEqual([]);
    last(h.sockets).emit("open");
    expect(last(h.sockets).frames()).toEqual([{ t: "sub", topics: ["statistics"] }]);
  });

  test("a string payload and an already-parsed object both reach the handler as an object", () => {
    // The single JSON.parse shim in the app lives here; the transport hands
    // back text, but a test double (or a future binary codec) may not.
    const h = harness();
    openConnection(h);
    const seen: unknown[] = [];
    h.bus.subscribe("statistics", (data) => seen.push(data));
    const frame = { topic: "statistics", data: { kind: "today", today: null } } as const;
    last(h.sockets).push(JSON.stringify(frame));
    last(h.sockets).push(frame satisfies { topic: "statistics"; data: unknown });
    expect(seen).toEqual([frame.data, frame.data]);
  });

  test("a malformed frame is ignored instead of taking the connection down", () => {
    const h = harness();
    openConnection(h);
    const seen: unknown[] = [];
    h.bus.subscribe("metrics", (data) => seen.push(data));
    last(h.sockets).push("{not json");
    last(h.sockets).push(null);
    last(h.sockets).push(42);
    const sample = { time: "2026-08-16T10:00:00.000Z", metrics: { pv: 1 } };
    last(h.sockets).push(JSON.stringify({ topic: "metrics", data: sample }));
    expect(seen).toEqual([sample]);
  });

  test("handlers of a superseded socket are no-ops", () => {
    // The dropped socket can still flush a buffered frame after the reopen; it
    // carries pre-outage values that would overwrite the fresh ones.
    const h = harness();
    openConnection(h);
    const seen: unknown[] = [];
    h.bus.subscribe("evcc", (data) => seen.push(data));
    const stale = last(h.sockets);
    stale.emit("close");
    elapse();
    last(h.sockets).emit("open");
    stale.push(JSON.stringify({ topic: "evcc", data: "buffered during the outage" }));
    last(h.sockets).push(JSON.stringify({ topic: "evcc", data: "after the reconnect" }));
    expect(seen).toEqual(["after the reconnect"]);
  });

  test("the connection state follows the handshake and the drop", () => {
    const h = harness();
    openConnection(h);
    expect(h.connected).toEqual([true]);
    last(h.sockets).emit("close");
    expect(h.connected).toEqual([true, false]);
    elapse();
    last(h.sockets).emit("open");
    expect(h.connected).toEqual([true, false, true]);
  });

  test("the cadence estimate follows the spacing of metrics frames only", () => {
    // It is the app's one animation clock: `AnimatedNumber` stretches its glide
    // across it. A burst of log lines must not convince it the feed runs at
    // 10 Hz.
    const h = harness();
    openConnection(h);
    h.bus.subscribe("metrics", () => {});
    h.bus.subscribe("statistics", () => {});
    const metrics = JSON.stringify({ topic: "metrics", data: { time: "", metrics: {} } });
    const stats = JSON.stringify({ topic: "statistics", data: { kind: "today" } });
    // First metrics frame: nothing to measure against, so the seed stands.
    last(h.sockets).push(metrics);
    expect(h.cadence).toEqual([1000]);
    h.tick(4000);
    last(h.sockets).push(stats);
    h.tick(1000);
    last(h.sockets).push(metrics);
    // 5 s since the last metrics frame, smoothed against the 1 s seed.
    expect(last(h.cadence)).toBeCloseTo(2200, 5);
    expect(h.cadence).toHaveLength(2);
  });

  test("the first sample after a reconnect is not measured across the outage", () => {
    // The gap a dead socket leaves is not a poll interval.
    const h = harness();
    openConnection(h);
    h.bus.subscribe("metrics", () => {});
    const metrics = JSON.stringify({ topic: "metrics", data: { time: "", metrics: {} } });
    last(h.sockets).push(metrics);
    last(h.sockets).emit("close");
    h.tick(60_000);
    elapse();
    last(h.sockets).emit("open");
    last(h.sockets).push(metrics);
    expect(h.cadence).toEqual([1000, 1000]);
  });

  test("a fresh connection tells every held topic to start over", () => {
    // Only the bus knows an outage happened. A topic that keeps its own cadence
    // estimate (EVCC publishes on its own slow loop, not on our poll) would
    // otherwise measure its first push across the whole gap and stretch every
    // animation that reads it.
    const h = harness();
    openConnection(h);
    const resumed: string[] = [];
    h.bus.subscribe("evcc", () => {}, { onResume: () => resumed.push("evcc") });
    h.bus.subscribe("logs", () => {}, { onResume: () => resumed.push("logs") });
    expect(resumed).toEqual([]);
    last(h.sockets).emit("close");
    h.tick(60_000);
    elapse();
    last(h.sockets).emit("open");
    expect(resumed).toEqual(["evcc", "logs"]);
  });

  test("a topic given back before the reconnect is not told to start over", () => {
    const h = harness();
    openConnection(h);
    const resumed: string[] = [];
    const release = h.bus.subscribe("evcc", () => {}, { onResume: () => resumed.push("evcc") });
    release();
    last(h.sockets).emit("close");
    h.tick(60_000);
    elapse();
    last(h.sockets).emit("open");
    expect(resumed).toEqual([]);
  });

  test("releasing the shell's lease closes the socket", () => {
    const h = harness();
    const release = openConnection(h);
    h.bus.subscribe("metrics", () => {});
    release();
    expect(last(h.sockets).closed).toBe(1);
  });

  test("a topic subscribed while the socket is down is sent once, on the next open", () => {
    // The reconnect replay and the pending subscribe are two paths to the same
    // frame; only one of them may write it.
    const h = harness();
    openConnection(h);
    h.bus.subscribe("metrics", () => {});
    last(h.sockets).emit("close");
    h.bus.subscribe("logs", () => {});
    elapse();
    last(h.sockets).emit("open");
    expect(last(h.sockets).frames()).toEqual([{ t: "sub", topics: ["metrics", "logs"] }]);
  });

  test("a topic queued mid-outage is forgotten when the shell's lease goes away", () => {
    // The two halves of "what this connection was told" must never diverge. The
    // drop empties `#sent` while the queued `sub` frame is still in the outbox;
    // the card then unmounts and writes no `unsub`, because as far as the bus is
    // concerned the topic was never sent. Flushing that stale frame onto the next
    // socket subscribes the server to a topic with no handler on this side — with
    // `logs` in the slot, the admin firehose pushed at a client that gave it back,
    // and never unsubscribed.
    const h = harness();
    const release = openConnection(h);
    last(h.sockets).emit("close");
    const drop = h.bus.subscribe("logs", () => {});
    release();
    drop();
    h.bus.connect();
    last(h.sockets).emit("open");
    expect(h.sockets).toHaveLength(2);
    expect(last(h.sockets).frames()).toEqual([]);
  });

  test("the same function subscribed twice is two subscriptions, not one", () => {
    // Two cards can legitimately pass the same module-level callback. Counting
    // by function identity would let the first disposer give the topic back
    // while the second card is still on screen.
    const h = harness();
    openConnection(h);
    const seen: unknown[] = [];
    const handler = (data: unknown): void => {
      seen.push(data);
    };
    const first = h.bus.subscribe("evcc", handler);
    h.bus.subscribe("evcc", handler);
    first();
    expect(last(h.sockets).frames()).toEqual([{ t: "sub", topics: ["evcc"] }]);
    last(h.sockets).push(JSON.stringify({ topic: "evcc", data: "state" }));
    expect(seen).toEqual(["state"]);
  });

  test("a handler that throws does not rob the other handlers of the frame", () => {
    const h = harness();
    openConnection(h);
    const seen: unknown[] = [];
    h.bus.subscribe("evcc", () => {
      throw new Error("a card rendered badly");
    });
    h.bus.subscribe("evcc", (data) => seen.push(data));
    last(h.sockets).push(JSON.stringify({ topic: "evcc", data: "state" }));
    expect(seen).toEqual(["state"]);
  });
});

// A plant can hold several devices, and the dashboard shows one at a time. The
// bus carries which one alongside the `sub` — the topic vocabulary is the
// server's closed, gated set, so the device cannot ride inside a topic name.
describe("LiveBus device scope", () => {
  // The reconnect case drives the backoff timer, which only exists while the
  // fakes are installed.
  beforeEach(installFakeTimers);
  afterEach(() => {
    globalThis.setTimeout = realSetTimeout;
    globalThis.clearTimeout = realClearTimeout;
  });

  test("names no device until one is chosen — what the server calls its lead", () => {
    const h = harness();
    openConnection(h);

    h.bus.subscribe("metrics", () => {});

    expect(last(h.sockets).frames()).toEqual([{ t: "sub", topics: ["metrics"] }]);
  });

  test("carries the chosen device on the sub frame", () => {
    const h = harness();
    openConnection(h);
    h.bus.setDevice("barn");

    h.bus.subscribe("metrics", () => {});

    expect(last(h.sockets).frames()).toEqual([{ t: "sub", topics: ["metrics"], deviceId: "barn" }]);
  });

  test("choosing a device re-subscribes the held topics to it", () => {
    // The frames already flowing are the previous device's. Without the
    // re-subscribe the panel would keep painting the old machine.
    const h = harness();
    openConnection(h);
    h.bus.subscribe("metrics", () => {});
    last(h.sockets).sent.length = 0;

    h.bus.setDevice("barn");

    expect(last(h.sockets).frames()).toEqual([{ t: "sub", topics: ["metrics"], deviceId: "barn" }]);
  });

  test("choosing the device already chosen sends nothing", () => {
    // A store re-asserting its selection must not re-prime a backfill it has.
    const h = harness();
    openConnection(h);
    h.bus.setDevice("barn");
    h.bus.subscribe("metrics", () => {});
    last(h.sockets).sent.length = 0;

    h.bus.setDevice("barn");

    expect(last(h.sockets).frames()).toEqual([]);
  });

  test("a reconnect replays the device, not just the topics", () => {
    // `#sent` is cleared on drop and the diff is the replay; the device is part
    // of what the new connection has not been told.
    const h = harness();
    openConnection(h);
    h.bus.setDevice("barn");
    h.bus.subscribe("metrics", () => {});

    last(h.sockets).emit("close");
    elapse();
    last(h.sockets).emit("open");

    expect(last(h.sockets).frames()).toEqual([{ t: "sub", topics: ["metrics"], deviceId: "barn" }]);
  });

  test("choosing a device before the socket opens is not lost", () => {
    const h = harness();
    h.bus.setDevice("barn");
    openConnection(h);

    h.bus.subscribe("metrics", () => {});

    expect(last(h.sockets).frames()).toEqual([{ t: "sub", topics: ["metrics"], deviceId: "barn" }]);
  });

  test("going back to the plant default drops the device from the frame", () => {
    const h = harness();
    openConnection(h);
    h.bus.setDevice("barn");
    h.bus.subscribe("metrics", () => {});
    last(h.sockets).sent.length = 0;

    h.bus.setDevice(null);

    expect(last(h.sockets).frames()).toEqual([{ t: "sub", topics: ["metrics"] }]);
  });
});
