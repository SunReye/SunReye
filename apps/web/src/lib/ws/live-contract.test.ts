/**
 * The join between the two halves of the live socket.
 *
 * `apps/server/src/routes/ws-connection.test.ts` proves the server primes a
 * topic before it goes live; `./bus.test.ts` proves the browser asks for its
 * topics and fans the frames out. Neither one crosses the wire, and the wire is
 * where the five REST prime-on-open calls used to live: the stores dropped them
 * on the strength of the subscribe-time backfill, so a disagreement about a
 * topic name, an envelope key or a payload shape is now the difference between
 * "the dashboard paints on open" and "every card is empty until the next tick"
 * — with both unit suites green, because each half is self-consistent.
 *
 * So this file runs the *real* `createWsConnections` handlers against the
 * *real* `LiveBus`, bolted together by a socket pair, and asserts what only the
 * pair can show: the client's `sub` comes back on the same topic, the backfill
 * lands before any live frame for that topic, `logs` arrives as an array while
 * every other topic arrives as an object, and `metrics` — which has no
 * server-side snapshot by design — still delivers.
 *
 * It lives on the web side because `bus.ts` resolves `$lib/*`, which only maps
 * under `apps/web`; the server modules are plain relative imports and need no
 * alias. Nothing is mocked: the handlers take injected deps precisely so they
 * can be driven without an HTTP server.
 */

import { describe, expect, test } from "bun:test";
import type { WsTopic, WsTopicPayloads } from "@SunReye/contracts/ws";
import {
  type TopicBackfill,
  type WsSocket,
  createWsConnections,
} from "../../../../server/src/routes/ws-connection";
import { wsFrame } from "../../../../server/src/routes/ws-topics";
import type { TopicAccess } from "../../../../server/src/routes/ws-subscribe";
import { createStreams } from "../../../../server/src/shared/streams";
import { LiveBus } from "./bus";
import type { SocketLike } from "./reconnecting-socket";

/** A signed-in admin: every topic is permitted, so nothing here is a denial test. */
const admin: TopicAccess = { dashboard: true, admin: true };

/** A promise the test resolves by hand, standing in for a slow snapshot query. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/**
 * The topics whose live payloads are buffered while their snapshot is read —
 * every topic that has a backfill except `logs`, which reads a synchronous ring
 * buffer and opts out (see the server's `ws-topics.ts`).
 */
const BUFFERED: readonly WsTopic[] = ["plant", "evcc", "statistics", "automations"];

/**
 * The topics whose bus payload goes on the wire unchanged — everything but
 * `logs`, which is coalesced into a batch. `metrics` belongs here even though
 * it has no snapshot: it is republished like the rest, and leaving it out is
 * how a "metrics never arrives" harness quietly proves nothing.
 */
const REPUBLISHED: readonly WsTopic[] = ["metrics", "plant", "evcc", "statistics", "automations"];

/**
 * Marker payloads rather than real `EvccState`/`InverterSample` values.
 *
 * What is under test is the envelope and the ordering, and a marker makes a
 * misdelivered frame name its own origin in the failure message. The topic↔
 * payload pairing itself is a compile-time claim (`WsTopicPayloads`), already
 * enforced on both sides.
 */
const snapshotOf = (topic: WsTopic) => ({ from: "backfill", topic });
const liveOf = (topic: WsTopic) => ({ from: "live", topic });

/**
 * Both ends of one connection, wired to each other.
 *
 * The fan-out is the part production keeps in `index.ts`: the server's read-side
 * bus is subscribed once per topic and republishes the payload *enveloped* on
 * the `mux:` pub/sub name, which the socket joins when a priming run promotes
 * it. Reproducing that here rather than importing it is deliberate — it is the
 * publisher, not the contract, and the contract is what the two ends have to
 * agree on.
 */
function bridge(options: { backfill?: Record<string, () => unknown> } = {}) {
  const streams = createStreams();
  /** Sockets that have joined each `mux:` pub/sub name, keyed by that name. */
  const fanout = new Map<string, Set<WsSocket>>();
  /** Frames the server wrote, raw, in write order — acks included. */
  const serverWrote: string[] = [];
  /** Everything the handlers are still working on, so a test can wait for it. */
  const inflight: Promise<unknown>[] = [];

  const publish = (name: string, frame: string) => {
    for (const ws of fanout.get(name) ?? []) ws.send(frame);
  };

  const handlers = createWsConnections({
    streams,
    access: async () => admin,
    backfill: (options.backfill ?? {}) as unknown as TopicBackfill,
    // The tests resolve their own snapshots; nothing may wait on a real clock.
    primeTimeoutMs: 1_000,
    accessTimeoutMs: 1_000,
  });

  // The enveloped republish, one per topic, exactly as `index.ts` registers it
  // — and through the same `wsFrame`, so the live half of this test crosses the
  // server's envelope rather than restating it.
  for (const topic of REPUBLISHED)
    streams.subscribe(topic as "evcc", (data) => publish(topic, wsFrame(topic, data)));
  // `logs` is the one topic whose bus payload (an entry) differs from its wire
  // payload (a batch). Production coalesces on a 250 ms flush timer; batching
  // each entry on its own keeps the wire shape — an array — without a timer.
  streams.subscribe("logs", (entry) => publish("logs", wsFrame("logs", [entry])));

  let sockets = 0;
  /** The server's view of one connection: writes to the client, joins the fan-out. */
  const serverSocket = (deliver: (frame: string) => void): WsSocket => {
    sockets += 1;
    const id = `socket-${sockets}`;
    const ws: WsSocket = {
      id,
      request: { headers: new Headers() },
      send(data: string) {
        serverWrote.push(data);
        deliver(data);
        return undefined;
      },
      subscribe(name: string) {
        const joined = fanout.get(name) ?? new Set<WsSocket>();
        fanout.set(name, joined);
        joined.add(ws);
        return undefined;
      },
      unsubscribe(name: string) {
        fanout.get(name)?.delete(ws);
        return undefined;
      },
      close() {
        return undefined;
      },
    };
    return ws;
  };

  /** The client's view: writes go to the handlers, server frames come back raw. */
  class ClientSocket implements SocketLike {
    #message: ((message: { data: unknown }) => void) | null = null;
    #events = new Map<string, () => void>();
    #server: WsSocket;
    sent: string[] = [];

    constructor() {
      this.#server = serverSocket((frame) => this.#message?.({ data: frame }));
      inflight.push(handlers.open(this.#server));
    }
    subscribe(handler: (message: { data: unknown }) => void): void {
      this.#message = handler;
    }
    on(event: "open" | "close" | "error", handler: () => void): void {
      this.#events.set(event, handler);
    }
    send(data: string): void {
      this.sent.push(data);
      inflight.push(handlers.message(this.#server, data));
    }
    close(): void {
      handlers.close(this.#server);
    }
    emit(event: "open" | "close" | "error"): void {
      this.#events.get(event)?.();
    }
  }

  const clients: ClientSocket[] = [];
  const bus = new LiveBus({
    create: () => {
      const client = new ClientSocket();
      clients.push(client);
      return client;
    },
    onConnected: () => {},
    onCadence: () => {},
  });

  /** Open the shell's lease and complete the handshake. */
  const open = () => {
    bus.connect();
    const client = clients.at(-1);
    if (!client) throw new Error("expected the lease to have created a socket");
    client.emit("open");
    return client;
  };

  /**
   * Let every queued frame, priming run and republish finish. Two macrotask
   * turns, because a `sub` is queued behind the connection's authorization and
   * the priming run it starts awaits its own snapshot after that.
   */
  const settle = async () => {
    await Promise.all(inflight.splice(0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    await Promise.all(inflight.splice(0));
    await new Promise((resolve) => setTimeout(resolve, 0));
  };

  /** Push one live payload onto the server's read-side bus. */
  const emitLive = (topic: WsTopic, payload: unknown) =>
    streams.emit(topic as "evcc", payload as WsTopicPayloads["evcc"]);

  /** The `__ack` payloads the server wrote back, in order, one per `sub` frame. */
  const acks = () =>
    serverWrote
      .map((raw) => JSON.parse(raw) as { topic: string; data: unknown })
      .filter((frame) => frame.topic === "__ack")
      .map((frame) => frame.data);

  return { bus, open, settle, emitLive, acks };
}

/**
 * Subscribe to any topic through one code path.
 *
 * `LiveBus.subscribe` ties the handler's payload to the topic literal, which a
 * loop over the union cannot satisfy; the pairing is proven by the type system
 * at every real call site, so the cast costs the test nothing.
 */
function listen(bus: LiveBus, topic: WsTopic, on: (data: unknown) => void): () => void {
  return bus.subscribe(topic as "evcc", on as (data: WsTopicPayloads["evcc"]) => void);
}

describe("client subscribe → server prime → first paint", () => {
  for (const topic of BUFFERED) {
    test(`${topic}: the snapshot reaches the subscriber before any live frame`, async () => {
      // The window that makes this worth crossing the wire: the snapshot query
      // is still running when a live payload is emitted. The server buffers it,
      // the client must still see the backfill first — otherwise the card paints
      // the newer value and is then overwritten by older data.
      const snapshot = deferred<unknown>();
      const wire = bridge({ backfill: { [topic]: () => snapshot.promise } });
      wire.open();

      const seen: unknown[] = [];
      listen(wire.bus, topic, (data) => seen.push(data));
      await wire.settle();
      expect(seen).toEqual([]);

      wire.emitLive(topic, liveOf(topic));
      snapshot.resolve(snapshotOf(topic));
      await wire.settle();

      expect(seen).toEqual([snapshotOf(topic), liveOf(topic)]);
    });
  }

  test("logs: the ring buffer reaches the subscriber before the next batch", async () => {
    // `logs` opts out of priming-window buffering, so its live payload cannot
    // be emitted mid-snapshot the way the others are: its snapshot is read
    // synchronously, and a batch published before the promotion has no
    // subscriber to reach. The claim it can make is the one that matters —
    // nothing live precedes the backfill.
    const wire = bridge({ backfill: { logs: () => [snapshotOf("logs")] } });
    wire.open();

    const seen: unknown[] = [];
    listen(wire.bus, "logs", (data) => seen.push(data));
    await wire.settle();
    expect(seen).toEqual([[snapshotOf("logs")]]);

    wire.emitLive("logs", liveOf("logs"));
    await wire.settle();
    expect(seen).toEqual([[snapshotOf("logs")], [liveOf("logs")]]);
  });

  test("metrics has no snapshot to send and still goes live", async () => {
    // Deliberately absent from the backfill table: the next sample is a poll
    // interval away and there is no meaningful current one to replay. The
    // failure this guards is the promotion being skipped along with the
    // snapshot — a subscribed topic that never delivers a byte.
    const wire = bridge();
    wire.open();

    const seen: unknown[] = [];
    listen(wire.bus, "metrics", (data) => seen.push(data));
    await wire.settle();
    expect(seen).toEqual([]);

    wire.emitLive("metrics", liveOf("metrics"));
    await wire.settle();
    expect(seen).toEqual([liveOf("metrics")]);
  });

  test("every topic comes back on the name the client asked for", async () => {
    // The whole point of the envelope. A frame delivered under a different name
    // than the `sub` that asked for it reaches no handler at all — `LiveBus`
    // looks the topic up and silently drops a miss, which is exactly why this
    // cannot be caught on either side alone.
    const topics: WsTopic[] = ["metrics", "evcc", "statistics", "automations", "logs"];
    const wire = bridge({
      backfill: {
        evcc: () => snapshotOf("evcc"),
        statistics: () => snapshotOf("statistics"),
        automations: () => snapshotOf("automations"),
        logs: () => [snapshotOf("logs")],
      },
    });
    wire.open();

    /** Which topic each frame was *delivered on*, paired with what it carried. */
    const delivered: { topic: WsTopic; data: unknown }[] = [];
    for (const topic of topics) listen(wire.bus, topic, (data) => delivered.push({ topic, data }));
    await wire.settle();
    for (const topic of topics) wire.emitLive(topic, liveOf(topic));
    await wire.settle();

    // Each payload names its own topic, so a frame that arrived on the wrong
    // subscription — or on none — is visible rather than merely absent.
    for (const { topic, data } of delivered)
      expect(Array.isArray(data) ? data[0] : data).toMatchObject({ topic });

    // The server acked each `sub` under the name it was asked for — one frame
    // per topic, because each subscriber mounts on its own — and every one of
    // those names then delivered.
    expect(wire.acks()).toEqual(topics.map((topic) => ({ subscribed: [topic], denied: [] })));
    expect(new Set(delivered.map((frame) => frame.topic))).toEqual(new Set(topics));
  });

  test("logs is the only topic that arrives as an array", async () => {
    // The one shape divergence in the contract: log lines are coalesced into a
    // batch at the socket boundary, every other topic is one object per emit. A
    // consumer that spreads a batch it expected to be an object renders nothing
    // and throws nothing.
    const topics: WsTopic[] = ["evcc", "statistics", "automations", "logs"];
    const wire = bridge({
      backfill: {
        evcc: () => snapshotOf("evcc"),
        statistics: () => snapshotOf("statistics"),
        automations: () => snapshotOf("automations"),
        logs: () => [snapshotOf("logs")],
      },
    });
    wire.open();

    const shapes = new Map<WsTopic, string[]>();
    for (const topic of topics)
      listen(wire.bus, topic, (data) => {
        const seen = shapes.get(topic) ?? [];
        shapes.set(topic, seen);
        seen.push(Array.isArray(data) ? "array" : typeof data);
      });
    await wire.settle();
    for (const topic of topics) wire.emitLive(topic, liveOf(topic));
    await wire.settle();

    // Both the snapshot and the live frame of a topic carry the same shape.
    expect(Object.fromEntries(shapes)).toEqual({
      evcc: ["object", "object"],
      statistics: ["object", "object"],
      automations: ["object", "object"],
      logs: ["array", "array"],
    });
  });
});
