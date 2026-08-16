/**
 * The per-connection state machine of the multiplexed `/ws` endpoint.
 *
 * Everything proven here is about *timing*, which is why it is tested against a
 * plain fake socket rather than a running server: Elysia does not await either
 * the `open` or the `message` handler (`websocket.open(ws) { ws.data.open?.(ws) }`),
 * so every await inside them is a window in which the next client frame is
 * already being processed. The bugs that live in those windows — a first `sub`
 * dropped, an `unsub` overtaking the `sub` it follows, a stale backfill landing
 * on top of a fresh one — are indistinguishable from "the feed is just quiet"
 * in production, so they are pinned here.
 *
 * No mocking: every collaborator is a hook on the deps object.
 */

import { describe, expect, test } from "bun:test";
import type { Streams } from "../shared/streams";
import { type TopicBackfill, type WsSocket, createWsConnections } from "./ws-connection";
import type { TopicAccess } from "./ws-subscribe";

/** Access of a signed-in admin: everything. */
const admin: TopicAccess = { dashboard: true, admin: true };
/** Access of a logged-out visitor while the public read-only dashboard is on. */
const anonViewer: TopicAccess = { dashboard: true, admin: false };
/** Access of a visitor with the dashboard locked down: nothing at all. */
const stranger: TopicAccess = { dashboard: false, admin: false };

/** A promise the test resolves by hand, standing in for a slow query. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Let every already-scheduled microtask (and timer, if any) run. */
const settle = async (ms = 0) => {
  await new Promise((resolve) => setTimeout(resolve, ms));
};

/** A recording stand-in for {@link Streams} that can report live listener count. */
function fakeStreams() {
  const listeners = new Map<string, Set<(payload: never) => void>>();
  const streams = {
    emit(topic: string, payload: never) {
      // Copied first: a priming run detaches from inside its own handler.
      for (const listener of Array.from(listeners.get(topic) ?? [])) listener(payload);
    },
    subscribe(topic: string, listener: (payload: never) => void) {
      const set = listeners.get(topic) ?? new Set();
      listeners.set(topic, set);
      set.add(listener);
      return () => set.delete(listener);
    },
  } as unknown as Streams;

  return { streams, listenerCount: (topic: string) => listeners.get(topic)?.size ?? 0 };
}

/** A recording stand-in for the Elysia socket. */
function fakeSocket(id = "socket-1") {
  const sent: { topic: string; data: unknown }[] = [];
  const subscribed: string[] = [];
  const unsubscribed: string[] = [];
  /** Fan-out joins and leaves in the order they happened. */
  const events: string[] = [];
  let closed = false;
  /** Frame topics whose `send` fails the way a socket closing mid-write does. */
  const failing = new Set<string>();

  const ws: WsSocket = {
    id,
    data: { request: { headers: new Headers() } },
    send(data: string) {
      const frame = JSON.parse(data) as { topic: string; data: unknown };
      if (failing.has(frame.topic)) throw new Error("socket is closing");
      sent.push(frame);
    },
    subscribe(topic: string) {
      subscribed.push(topic);
      events.push(`sub ${topic}`);
    },
    unsubscribe(topic: string) {
      unsubscribed.push(topic);
      events.push(`unsub ${topic}`);
    },
    close() {
      closed = true;
    },
  };

  return {
    ws,
    sent,
    subscribed,
    unsubscribed,
    /** The last fan-out event for `topic`, or undefined if there was none. */
    lastEvent: (topic: string) => events.filter((e) => e.endsWith(` ${topic}`)).at(-1),
    get closed() {
      return closed;
    },
    /** Make writes of one topic's frames throw, until `healSends`. */
    failSendsFor(topic: string) {
      failing.add(topic);
    },
    healSends() {
      failing.clear();
    },
    /** Every frame for one topic, in delivery order. */
    frames: (topic: string) => sent.filter((frame) => frame.topic === topic),
    ack: () => sent.find((frame) => frame.topic === "__ack")?.data,
    acks: () => sent.filter((frame) => frame.topic === "__ack").map((frame) => frame.data),
  };
}

/**
 * Wire the handlers with controllable access and backfill.
 *
 * `backfill` is cast: the tests care about frame *ordering*, so the payloads are
 * marker strings rather than real inverter samples.
 */
function harness(options: {
  access?: () => TopicAccess | Promise<TopicAccess>;
  backfill?: Record<string, () => unknown>;
  primeTimeoutMs?: number;
  accessTimeoutMs?: number;
}) {
  const bus = fakeStreams();
  const accessCalls: number[] = [];
  const handlers = createWsConnections({
    streams: bus.streams,
    access: async () => {
      accessCalls.push(accessCalls.length);
      return (options.access ?? (() => admin))();
    },
    backfill: (options.backfill ?? {}) as unknown as TopicBackfill,
    primeTimeoutMs: options.primeTimeoutMs,
    accessTimeoutMs: options.accessTimeoutMs,
  });

  return { handlers, bus, accessCount: () => accessCalls.length };
}

describe("open", () => {
  test("a sub frame that arrives before authorization resolves is still honoured", async () => {
    // The protocol-breaking one. A conformant client sends its first `sub` from
    // `onopen`; Elysia does not await `open`, so that frame is delivered while
    // the two auth round-trips are still in flight. Dropping it leaves a live
    // socket subscribed to nothing, with no ack, no error and no retry.
    const gate = deferred<TopicAccess>();
    const h = harness({ access: () => gate.promise });
    const sock = fakeSocket();

    const opening = h.handlers.open(sock.ws);
    const framed = h.handlers.message(sock.ws, { t: "sub", topics: ["metrics"] });
    gate.resolve(admin);
    await Promise.all([opening, framed]);

    expect(sock.ack()).toEqual({ subscribed: ["metrics"], denied: [] });
    expect(sock.subscribed).toContain("metrics");
  });

  test("a connection that may read nothing is closed and its queued frame is dropped", async () => {
    const h = harness({ access: () => stranger });
    const sock = fakeSocket();

    const opening = h.handlers.open(sock.ws);
    const framed = h.handlers.message(sock.ws, { t: "sub", topics: ["metrics"] });
    await Promise.all([opening, framed]);

    expect(sock.closed).toBe(true);
    expect(sock.sent).toEqual([]);
    expect(sock.subscribed).toEqual([]);
  });

  test("an authorization lookup that throws closes the connection instead of half-opening it", async () => {
    // Fail closed. A lookup that threw used to reject out of the unawaited
    // handler, leaving a socket that was never registered — and, once the
    // registration moved before the await, one that would answer frames it was
    // never cleared for.
    const h = harness({
      access: () => {
        throw new Error("db down");
      },
    });
    const sock = fakeSocket();

    await h.handlers.open(sock.ws);
    await h.handlers.message(sock.ws, { t: "sub", topics: ["metrics"] });

    expect(sock.closed).toBe(true);
    expect(sock.sent).toEqual([]);
  });
});

describe("the pub/sub name a topic joins", () => {
  test("every topic joins and leaves the fan-out under its own bare name", async () => {
    // The other half of the pair pinned in ./ws-publish.test.ts: the publisher
    // sends on the bare topic name, so any decoration here (the `mux:` prefix
    // the migration needed while the five legacy routes still owned the bare
    // names) is an acked subscription that never delivers a byte — no error on
    // either side, just a socket that stays quiet.
    const topics = ["metrics", "evcc", "statistics", "logs", "automations"];
    const h = harness({});
    const sock = fakeSocket();
    await h.handlers.open(sock.ws);

    await h.handlers.message(sock.ws, { t: "sub", topics });
    await settle();
    // Sorted: the primes run concurrently, so the join *order* is not the
    // contract — the names are.
    expect([...sock.subscribed].sort()).toEqual([...topics].sort());

    await h.handlers.message(sock.ws, { t: "unsub", topics });
    await settle();
    expect([...sock.unsubscribed].sort()).toEqual([...topics].sort());
  });
});

describe("frame ordering", () => {
  test("an unsub that follows a sub is applied after it, never before", async () => {
    // A component that mounts and immediately unmounts (or a navigation) emits
    // exactly this pair. The sub branch awaits the access lookup and the unsub
    // branch does not, so without serialisation the unsub runs first against an
    // empty set — a no-op — and the sub then subscribes something the client
    // believes it gave back.
    // The gate is opened only for the frames, so `open` itself resolves at once.
    const gate = deferred<TopicAccess>();
    let gated = false;
    const h = harness({ access: () => (gated ? gate.promise : admin) });
    const sock = fakeSocket();
    await h.handlers.open(sock.ws);
    gated = true;

    const subbed = h.handlers.message(sock.ws, { t: "sub", topics: ["logs"] });
    const unsubbed = h.handlers.message(sock.ws, { t: "unsub", topics: ["logs"] });
    gate.resolve(admin);
    await Promise.all([subbed, unsubbed]);
    await settle();

    // Whether the sub got as far as joining the fan-out before the unsub was
    // handled does not matter; what matters is that the unsub is applied to the
    // subscription the sub created, so the feed ends up off. Out of order, the
    // unsub found an empty set, did nothing at all, and the topic stayed live.
    expect(sock.lastEvent("logs")).toBe("unsub logs");
  });

  test("a stale backfill cannot land after a newer one has promoted", async () => {
    // sub → unsub → sub starts a second prime while the first is still awaiting
    // its query. When the slow first one finally resolves the topic is wanted
    // again, so "is this topic subscribed" is not the question — "is this run
    // still the current one" is.
    const first = deferred<string>();
    const second = deferred<string>();
    let call = 0;
    const h = harness({
      backfill: {
        statistics: () => (call++ === 0 ? first.promise : second.promise),
      },
    });
    const sock = fakeSocket();
    await h.handlers.open(sock.ws);

    await h.handlers.message(sock.ws, { t: "sub", topics: ["statistics"] });
    await h.handlers.message(sock.ws, { t: "unsub", topics: ["statistics"] });
    await h.handlers.message(sock.ws, { t: "sub", topics: ["statistics"] });

    second.resolve("fresh");
    await settle();
    first.resolve("stale");
    await settle();

    expect(sock.frames("statistics").map((frame) => frame.data)).toEqual(["fresh"]);
  });

  test("a superseded prime finishing does not disarm the run that replaced it", async () => {
    // The generation is not only about which snapshot wins — the abandon handle
    // is stored per topic, so a stale run reaching its epilogue must not clear
    // the handle the *current* run registered. Without that check, `close` had
    // nothing left to abandon: the newer run's buffering listener stayed on the
    // bus, with its array growing, for the life of the process.
    const first = deferred<string>();
    const second = deferred<string>();
    let call = 0;
    const h = harness({
      backfill: { statistics: () => (call++ === 0 ? first.promise : second.promise) },
    });
    const sock = fakeSocket();
    await h.handlers.open(sock.ws);

    await h.handlers.message(sock.ws, { t: "sub", topics: ["statistics"] });
    await h.handlers.message(sock.ws, { t: "unsub", topics: ["statistics"] });
    await h.handlers.message(sock.ws, { t: "sub", topics: ["statistics"] });
    await settle();

    // The stale run finishes while the second is still awaiting its snapshot.
    first.resolve("stale");
    await settle();
    expect(h.bus.listenerCount("statistics")).toBe(1);

    h.handlers.close(sock.ws);

    expect(h.bus.listenerCount("statistics")).toBe(0);
    second.resolve("fresh");
    await settle();
    expect(sock.frames("statistics")).toEqual([]);
  });
});

describe("revocation", () => {
  test("a topic the session may no longer read is torn off the socket, not merely denied", async () => {
    // The ack used to say `denied: ["logs"]` while the log firehose kept
    // flowing on the very same socket, because nothing unsubscribed it. An
    // admin demoted mid-session must stop receiving, not be told a comforting
    // lie.
    let access: TopicAccess = admin;
    const h = harness({ access: () => access });
    const sock = fakeSocket();
    await h.handlers.open(sock.ws);

    await h.handlers.message(sock.ws, { t: "sub", topics: ["logs"] });
    await settle();
    expect(sock.subscribed).toContain("logs");

    access = anonViewer;
    await h.handlers.message(sock.ws, { t: "sub", topics: ["logs"] });
    await settle();

    expect(sock.unsubscribed).toContain("logs");
    expect(sock.acks().at(-1)).toEqual({ subscribed: [], denied: ["logs"] });
  });

  test("a revoked topic is dropped from the connection's state, so a later re-sub re-primes", async () => {
    let access: TopicAccess = admin;
    let backfills = 0;
    const h = harness({
      access: () => access,
      backfill: {
        automations: () => {
          backfills += 1;
          return `snapshot-${backfills}`;
        },
      },
    });
    const sock = fakeSocket();
    await h.handlers.open(sock.ws);

    await h.handlers.message(sock.ws, { t: "sub", topics: ["automations"] });
    await settle();
    access = anonViewer;
    await h.handlers.message(sock.ws, { t: "sub", topics: ["automations"] });
    await settle();
    access = admin;
    await h.handlers.message(sock.ws, { t: "sub", topics: ["automations"] });
    await settle();

    expect(backfills).toBe(2);
    expect(sock.frames("automations").map((frame) => frame.data)).toEqual([
      "snapshot-1",
      "snapshot-2",
    ]);
  });

  test("every held topic is re-checked on the next frame, not only the ones it names", async () => {
    // The revocation sweep used to iterate the frame's own `denied` list, so it
    // could only revoke a topic the client happened to name again. A demoted
    // admin that asks for something unrelated — the normal case, since a page
    // subscribes once per component — kept both admin feeds running on a socket
    // that was no longer allowed either of them.
    let access: TopicAccess = admin;
    const h = harness({ access: () => access });
    const sock = fakeSocket();
    await h.handlers.open(sock.ws);

    await h.handlers.message(sock.ws, { t: "sub", topics: ["logs", "automations"] });
    await settle();
    expect(sock.subscribed).toEqual(["logs", "automations"]);

    access = anonViewer;
    await h.handlers.message(sock.ws, { t: "sub", topics: ["metrics"] });
    await settle();

    expect(sock.lastEvent("logs")).toBe("unsub logs");
    expect(sock.lastEvent("automations")).toBe("unsub automations");
    // And the revoked feeds really are off the connection: a payload published
    // now reaches neither.
    expect(h.bus.listenerCount("automations")).toBe(0);
  });

  test("a topic the session may still read is untouched by the sweep", async () => {
    // The sweep must revoke, not churn: re-dropping a still-permitted topic
    // would tear it off the fan-out and (because the ack reports it as
    // subscribed) leave the client silently unfed.
    const h = harness({ access: () => anonViewer, backfill: { metrics: () => null } });
    const sock = fakeSocket();
    await h.handlers.open(sock.ws);

    await h.handlers.message(sock.ws, { t: "sub", topics: ["metrics"] });
    await settle();
    await h.handlers.message(sock.ws, { t: "sub", topics: ["statistics"] });
    await settle();

    expect(sock.lastEvent("metrics")).toBe("sub metrics");
    expect(sock.unsubscribed).toEqual([]);
  });

  test("a session that vanishes mid-connection closes the socket instead of idling", async () => {
    // Access granting nothing at all is the same condition `open` closes on. It
    // can happen later too — the session expired, or the public dashboard was
    // switched off — and the connection has no way back: every topic is denied
    // from here on, so leaving it open only keeps a socket that can never be
    // fed and whose held topics would have to be swept on every frame.
    let access: TopicAccess = admin;
    const h = harness({ access: () => access });
    const sock = fakeSocket();
    await h.handlers.open(sock.ws);

    await h.handlers.message(sock.ws, { t: "sub", topics: ["metrics"] });
    await settle();
    const framesBefore = sock.sent.length;

    access = stranger;
    await h.handlers.message(sock.ws, { t: "sub", topics: ["metrics"] });
    await settle();

    expect(sock.closed).toBe(true);
    // No ack: the connection is gone, not answered.
    expect(sock.sent.length).toBe(framesBefore);
    // And the state is torn down, so a frame still in flight does nothing.
    await h.handlers.message(sock.ws, { t: "sub", topics: ["metrics"] });
    await settle();
    expect(sock.sent.length).toBe(framesBefore);
  });
});

describe("robustness", () => {
  test("an access lookup that throws does not reject out of the message handler", async () => {
    // The DB is down. Elysia fire-and-forgets this handler, so a rejection here
    // is an unhandled rejection per client frame, not an error anyone sees.
    let failing = false;
    const h = harness({
      access: () => {
        if (failing) throw new Error("db down");
        return admin;
      },
    });
    const sock = fakeSocket();
    await h.handlers.open(sock.ws);
    failing = true;

    await expect(
      h.handlers.message(sock.ws, { t: "sub", topics: ["metrics"] }),
    ).resolves.toBeUndefined();
    expect(sock.sent).toEqual([]);

    // And the connection is still usable once the DB comes back.
    failing = false;
    await h.handlers.message(sock.ws, { t: "sub", topics: ["metrics"] });
    expect(sock.ack()).toEqual({ subscribed: ["metrics"], denied: [] });
  });

  test("a topic entry that cannot be stringified is denied, not thrown", async () => {
    // `String({ toString: 1, valueOf: 2 })` is a TypeError, and it used to be
    // raised before the topic guard ever ran — one crafted frame, anonymously
    // reachable, and the handler rejected with the state half-mutated.
    const h = harness({});
    const sock = fakeSocket();
    await h.handlers.open(sock.ws);

    await h.handlers.message(sock.ws, {
      t: "sub",
      topics: [{ toString: 1, valueOf: 2 }, "metrics"],
    });

    const ack = sock.ack() as { subscribed: string[]; denied: string[] };
    expect(ack.subscribed).toEqual(["metrics"]);
    expect(ack.denied).toHaveLength(1);
  });

  test("a send that fails mid-prime leaves the topic re-subscribable", async () => {
    // If the delivery phase throws, the topic never promoted — but it was
    // already in the connection's subscribed set, so the "only prime what is
    // new" filter made every later `sub` a no-op. The client is acked as
    // subscribed to a topic that will never deliver a byte.
    let backfills = 0;
    const h = harness({
      backfill: {
        statistics: () => {
          backfills += 1;
          return `snapshot-${backfills}`;
        },
      },
    });
    const sock = fakeSocket();
    await h.handlers.open(sock.ws);

    sock.failSendsFor("statistics");
    await h.handlers.message(sock.ws, { t: "sub", topics: ["statistics"] });
    await settle();
    sock.healSends();

    await h.handlers.message(sock.ws, { t: "sub", topics: ["statistics"] });
    await settle();

    expect(backfills).toBe(2);
    expect(sock.frames("statistics").map((frame) => frame.data)).toEqual(["snapshot-2"]);
    expect(sock.subscribed).toContain("statistics");
  });

  test("an ack that fails to write leaves the topic re-subscribable", async () => {
    // Same wedge as the failing prime, on the other write. The topic went into
    // the subscribed set *before* the ack was sent, so an ack that threw (the
    // socket closing mid-write) left it there with no primes ever started: the
    // "only prime what is new" filter then swallowed every later `sub`, and the
    // client held a topic that could not deliver a byte.
    let backfills = 0;
    const h = harness({
      backfill: {
        statistics: () => {
          backfills += 1;
          return `snapshot-${backfills}`;
        },
      },
    });
    const sock = fakeSocket();
    await h.handlers.open(sock.ws);

    sock.failSendsFor("__ack");
    await h.handlers.message(sock.ws, { t: "sub", topics: ["statistics"] });
    await settle();
    expect(backfills).toBe(0);
    sock.healSends();

    await h.handlers.message(sock.ws, { t: "sub", topics: ["statistics"] });
    await settle();

    expect(backfills).toBe(1);
    expect(sock.frames("statistics").map((frame) => frame.data)).toEqual(["snapshot-1"]);
    expect(sock.subscribed).toContain("statistics");
  });

  test("an access lookup that never answers gives the connection back instead of wedging it", async () => {
    // Frames are serialised per connection, so one queued task that never
    // settles is one socket that never handles another frame — no error, no
    // close, just silence. The lookup is bounded for that reason.
    let hangs = false;
    const h = harness({
      access: () => (hangs ? new Promise<TopicAccess>(() => {}) : admin),
      accessTimeoutMs: 5,
    });
    const sock = fakeSocket();
    await h.handlers.open(sock.ws);

    hangs = true;
    const stalled = h.handlers.message(sock.ws, { t: "sub", topics: ["logs"] });
    await Promise.race([stalled, settle(200)]);
    // The stalled frame is dropped rather than answered…
    await expect(stalled).resolves.toBeUndefined();
    expect(sock.sent).toEqual([]);

    // …and the next frame on the same socket is handled normally.
    hangs = false;
    await h.handlers.message(sock.ws, { t: "sub", topics: ["logs"] });
    await settle();
    expect(sock.ack()).toEqual({ subscribed: ["logs"], denied: [] });
  });

  test("an absurdly long topic list is capped instead of echoed back in full", async () => {
    // Anonymously reachable: one frame up to Bun's 16 MB payload limit would
    // otherwise mean millions of loop iterations and a denied array of the same
    // size serialised straight back to the sender.
    const h = harness({});
    const sock = fakeSocket();
    await h.handlers.open(sock.ws);

    await h.handlers.message(sock.ws, {
      t: "sub",
      topics: Array.from({ length: 5000 }, (_, index) => `topic-${index}`),
    });

    const ack = sock.ack() as { subscribed: string[]; denied: string[] };
    expect(ack.denied.length).toBeLessThanOrEqual(64);
  });
});

describe("close", () => {
  test("closing stops an in-flight prime and detaches its buffering listener", async () => {
    // The prime closure holds the connection state directly, so before this the
    // "is it still wanted" check kept answering yes after the socket was gone:
    // the bus listener stayed attached and its buffer grew for every emit,
    // forever, per dead connection.
    const snapshot = deferred<string>();
    const h = harness({ backfill: { statistics: () => snapshot.promise } });
    const sock = fakeSocket();
    await h.handlers.open(sock.ws);

    await h.handlers.message(sock.ws, { t: "sub", topics: ["statistics"] });
    await settle();
    expect(h.bus.listenerCount("statistics")).toBe(1);

    h.handlers.close(sock.ws);

    expect(h.bus.listenerCount("statistics")).toBe(0);

    snapshot.resolve("late");
    await settle();
    expect(sock.frames("statistics")).toEqual([]);
    expect(sock.subscribed).toEqual([]);
  });

  test("a prime whose snapshot never settles gives up rather than buffering forever", async () => {
    const h = harness({
      backfill: { statistics: () => new Promise<string>(() => {}) },
      primeTimeoutMs: 5,
    });
    const sock = fakeSocket();
    await h.handlers.open(sock.ws);

    await h.handlers.message(sock.ws, { t: "sub", topics: ["statistics"] });
    await settle(25);

    // No snapshot to send, but the client still gets the live feed: a stalled
    // query must not cost it the topic.
    expect(h.bus.listenerCount("statistics")).toBe(0);
    expect(sock.subscribed).toContain("statistics");
  });
});
