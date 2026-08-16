/**
 * The per-connection state machine behind the multiplexed `/ws` endpoint.
 *
 * Split out of the route module so the parts that can go wrong are exercised
 * against a plain fake socket instead of a running Elysia server. What can go
 * wrong here is almost entirely *timing*, because Elysia awaits neither handler
 * — `websocket.open(ws) { ws.data.open?.(ws) }`, and `message` likewise — so
 * every `await` inside them is a window during which the next client frame is
 * already being handled:
 *
 * - **`open` registers synchronously.** Authorization is two DB round-trips,
 *   and a conformant client sends its first `sub` from `onopen`. Registering
 *   the connection after the await meant that frame found no state and was
 *   dropped without an ack, an error or a retry — a live socket subscribed to
 *   nothing, forever.
 * - **Frames are serialised per connection.** The `unsub` path is synchronous
 *   and the `sub` path awaits the access lookup, so `sub` immediately followed
 *   by `unsub` (a component that mounts and unmounts, or a navigation) used to
 *   execute in the wrong order: the `unsub` ran first against an empty set and
 *   the `sub` then subscribed something the client believes it gave back. One
 *   promise chain per connection restores the wire order, and the queued
 *   authorization from `open` is the head of it, which is what makes the first
 *   `sub` wait for the gate rather than race it.
 * - **Every priming run carries a generation.** "Is this topic subscribed" is
 *   not the same question as "is this run still the current one", and
 *   `sub → unsub → sub` makes the difference visible: the first, slow backfill
 *   would otherwise deliver its stale snapshot after the second has already
 *   painted. That is the very bug this module exists to remove.
 * - **Authorization is swept, not consulted.** Every `sub` frame re-decides the
 *   whole *held* set against a freshly computed access, so a demoted admin
 *   loses `logs` and `automations` on the next `sub` whatever that frame asks
 *   for; access that grants nothing at all closes the connection. The sweep is
 *   lazy and client-driven by design: an `unsub`, a malformed frame, or a
 *   client that simply goes quiet does not re-check, and there is no gate on
 *   the publish side — a demoted admin who sends no further `sub` keeps its
 *   feeds until it disconnects.
 *
 * {@link ./ws} keeps nothing but the route declaration and the upgrade policy.
 */

import type {
  ClientFrame,
  ServerAckFrame,
  ServerFrame,
  WsTopic,
  WsTopicPayloads,
} from "@SunReye/contracts/ws";
import { log } from "../shared/logging";
import type { StreamListener, Streams } from "../shared/streams";
import { primeTopic } from "./ws-priming";
import {
  type TopicAccess,
  parseClientFrame,
  resolveSubscribe,
  resolveUnsubscribe,
} from "./ws-subscribe";
import { bufferedWhilePriming, muxTopic } from "./ws-topics";

const wsLog = log("ws");

/**
 * How long a subscribe-time backfill may take before the topic goes live
 * without it.
 *
 * The snapshots are single indexed queries; ten seconds is far beyond any
 * healthy one. The bound matters because the buffering listener stays attached
 * to the bus for the whole run: a query that never returns would otherwise hold
 * that listener, and the array behind it, for the life of the process.
 */
const DEFAULT_PRIME_TIMEOUT_MS = 10_000;

/**
 * How long the authorization lookup may take before the frame that needs it is
 * given up on.
 *
 * The bound exists because frames are serialised per connection: the queue is
 * what keeps `sub` and `unsub` in wire order, and its cost is that one task
 * which never settles is one socket that never handles another frame — no
 * error, no close, just a live connection gone permanently deaf. `access` is
 * two indexed DB round-trips, so five seconds is far beyond any healthy one,
 * and exceeding it is treated exactly like a lookup that threw: fail closed,
 * drop the frame, let the queue move on.
 */
const DEFAULT_ACCESS_TIMEOUT_MS = 5_000;

/** Raised when {@link DEFAULT_ACCESS_TIMEOUT_MS} is exceeded. */
class AccessTimeoutError extends Error {
  constructor(ms: number) {
    super(`authorization lookup did not answer within ${ms}ms`);
    this.name = "AccessTimeoutError";
  }
}

/**
 * Subscribe-time snapshot readers: what a topic's current state is, sent once
 * to a connection that just asked for it. `null`/`undefined` means there is
 * nothing to send yet (EVCC before its first MQTT message, an empty log ring),
 * and a topic absent from the table has no snapshot at all — `metrics`, whose
 * next sample is a poll interval away and where there is no meaningful
 * "current" one to replay.
 */
export type TopicBackfill = {
  [K in WsTopic]?: () =>
    | WsTopicPayloads[K]
    | null
    | undefined
    | Promise<WsTopicPayloads[K] | null | undefined>;
};

export interface WsRoutesDeps {
  /** The read-side bus, used to buffer live payloads during a backfill. */
  streams: Streams;
  /**
   * What this request may read, computed fresh from its headers. Called once
   * per `sub` frame — never memoised, never captured at upgrade.
   */
  access: (headers: Headers) => Promise<TopicAccess>;
  /** Per-topic snapshot readers for the subscribe-time backfill. */
  backfill: TopicBackfill;
  /** Override for {@link DEFAULT_PRIME_TIMEOUT_MS}; the tests use it to not wait. */
  primeTimeoutMs?: number;
  /** Override for {@link DEFAULT_ACCESS_TIMEOUT_MS}; the tests use it to not wait. */
  accessTimeoutMs?: number;
}

/** What one open connection is holding. */
interface ConnectionState {
  /** Topics the client has asked for and not given back. */
  subscribed: Set<WsTopic>;
  /**
   * Per-topic priming generation, bumped when a run starts. A run compares the
   * value it started with against the current one, which is how a superseded
   * backfill knows to stay quiet even though its topic is subscribed again —
   * and, the part {@link ConnectionState.pending} depends on, how it knows to
   * keep its hands off the epilogue: only the current run may clear the
   * topic's abandon handle or drop the topic after a failed delivery.
   */
  generation: Map<WsTopic, number>;
  /** Abandon handles of the in-flight priming runs, so they can be stopped. */
  pending: Map<WsTopic, () => void>;
  /** Tail of this connection's frame queue: frames run one at a time, in order. */
  tail: Promise<void>;
  /** Cleared by `close`; every queued task checks it before touching the socket. */
  open: boolean;
}

/** The socket surface this module uses — structural, so it needs no Elysia types. */
export interface WsSocket {
  readonly id: string;
  readonly data: { request: { headers: Headers } };
  send(data: string): unknown;
  subscribe(topic: string): unknown;
  unsubscribe(topic: string): unknown;
  close(): unknown;
}

/** The handlers the Elysia route delegates to. */
export interface WsConnectionHandlers {
  /**
   * Registers the connection synchronously, then queues the authorization
   * check. The returned promise is for tests and for symmetry — Elysia drops
   * it.
   */
  open(ws: WsSocket): Promise<void>;
  close(ws: WsSocket): void;
  message(ws: WsSocket, raw: unknown): Promise<void>;
}

export function createWsConnections(deps: WsRoutesDeps): WsConnectionHandlers {
  // Keyed by socket id rather than held on `ws.data`: Elysia hands a fresh
  // context object to each handler, so the map is the only place per-connection
  // state survives from `open` to `message`. Dropped in `close`.
  const connections = new Map<string, ConnectionState>();

  /**
   * Append a task to this connection's queue.
   *
   * Serialising is the point: Elysia fire-and-forgets each handler, so without
   * a queue two frames from one client interleave at their first await and the
   * later one can win. Rejections are absorbed here rather than propagated —
   * nothing awaits these promises, so an escaping one is an unhandled rejection
   * per client frame (a DB outage makes that one per frame, from every open
   * socket).
   *
   * The trade: a task that never settles blocks every later frame on that
   * socket, and nothing here caps the chain's depth. The only unbounded await
   * inside a task is the authorization lookup, which is why that one carries
   * {@link DEFAULT_ACCESS_TIMEOUT_MS} — the queue always moves on.
   */
  const enqueue = (state: ConnectionState, task: () => Promise<void>): Promise<void> => {
    const next = state.tail.then(task).catch((error) => {
      wsLog.warn("ws frame handling failed: {error}", { error });
    });
    state.tail = next;
    return next;
  };

  /**
   * Ask the gate what this request may read, bounded in time.
   *
   * Rejects on a lookup that throws *and* on one that never answers; both are
   * "we do not know what this visitor may read", and both callers fail closed.
   */
  const authorize = async (ws: WsSocket): Promise<TopicAccess> => {
    const ms = deps.accessTimeoutMs ?? DEFAULT_ACCESS_TIMEOUT_MS;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        deps.access(ws.data.request.headers),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new AccessTimeoutError(ms)), ms);
        }),
      ]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  };

  /** Write one topic-tagged data frame. */
  const sendFrame = <K extends WsTopic>(ws: WsSocket, topic: K, data: WsTopicPayloads[K]) =>
    // The topic↔payload pairing is enforced by the parameter types; the cast is
    // only because a still-generic `K` cannot be shown to pick one member of
    // the distributed union (TS checks `{ topic: K; data: WsTopicPayloads[K] }`
    // against the union as a whole, which no single member satisfies).
    ws.send(JSON.stringify({ topic, data } as ServerFrame));

  /**
   * Stop delivering `topic` on this connection: leave the fan-out, forget the
   * subscription, and abandon any priming run still working on it. Shared by
   * `unsub` and by revocation, because they owe the client the same thing —
   * the feed actually stops.
   */
  const drop = (ws: WsSocket, state: ConnectionState, topic: WsTopic) => {
    state.subscribed.delete(topic);
    state.pending.get(topic)?.();
    state.pending.delete(topic);
    ws.unsubscribe(muxTopic(topic));
  };

  /**
   * Backfill one topic, then hand it to the shared fan-out.
   *
   * Split out generically over `K` so the snapshot, the buffered live payloads
   * and the frame all stay tied to the same topic's payload type.
   */
  const prime = async <K extends WsTopic>(ws: WsSocket, state: ConnectionState, topic: K) => {
    const generation = (state.generation.get(topic) ?? 0) + 1;
    state.generation.set(topic, generation);
    /** Whether this run is still the newest one for this topic. */
    const current = () => state.generation.get(topic) === generation;

    const outcome = await primeTopic<WsTopicPayloads[K], WsTopicPayloads[K]>({
      listen: bufferedWhilePriming(topic)
        ? (handler) =>
            // `StreamTopics[K]` is `WsTopicPayloads[K]` for every buffered
            // topic; `logs` is the sole divergence (entry vs batch) and it is
            // precisely the topic that opts out of buffering, so this listener
            // is never installed for it. The compiler cannot see that guard,
            // hence the widening cast.
            deps.streams.subscribe(topic, handler as unknown as StreamListener<K>)
        : undefined,
      snapshot: () => deps.backfill[topic]?.(),
      sendSnapshot: (snapshot) => sendFrame(ws, topic, snapshot),
      sendLive: (payload) => sendFrame(ws, topic, payload),
      promote: () => ws.subscribe(muxTopic(topic)),
      // All three conditions, re-read rather than captured: the socket may have
      // closed, the client may have unsubscribed, or a newer `sub` may have
      // started a second run while this one was awaiting its query.
      isActive: () => state.open && state.subscribed.has(topic) && current(),
      onAbandon: (abandon) => state.pending.set(topic, abandon),
      timeoutMs: deps.primeTimeoutMs ?? DEFAULT_PRIME_TIMEOUT_MS,
    });

    if (!current()) return;
    state.pending.delete(topic);
    // Delivery failed (a send on a socket that closed mid-prime, a payload that
    // would not serialise) and nothing was promoted. The topic has to leave the
    // subscribed set or the "only prime what is new" filter turns every later
    // `sub` into a no-op: the client would be acked as subscribed to a topic
    // that can never deliver a byte.
    if (outcome === "failed") state.subscribed.delete(topic);
  };

  /**
   * Drop every held topic the current access no longer permits.
   *
   * Revocation has to *revoke*, and revoke everything: the sweep runs over what
   * this connection is *holding*, not over the names the frame happens to
   * mention. An admin demoted mid-session subscribes to `metrics` from some
   * unrelated component; iterating that frame's `denied` list left both admin
   * feeds flowing, because neither was named. Re-deciding the held set through
   * the same gate that decides new subscriptions is what makes "a revoked role
   * loses the admin topics on the next `sub`" true rather than aspirational.
   */
  const sweepRevoked = (ws: WsSocket, state: ConnectionState, access: TopicAccess) => {
    const held = Array.from(state.subscribed);
    const stillAllowed = new Set(resolveSubscribe(held, access).subscribe);
    for (const topic of held) if (!stillAllowed.has(topic)) drop(ws, state, topic);
  };

  /** Ack one `sub` frame and start a backfill for each newly held topic. */
  const applySubscribe = (
    ws: WsSocket,
    state: ConnectionState,
    frame: Extract<ClientFrame, { t: "sub" }>,
    access: TopicAccess,
  ) => {
    const { subscribe, denied } = resolveSubscribe(frame.topics, access);

    // Only topics this connection does not already hold are primed: a repeat
    // `sub` must not re-run the backfill and re-send a snapshot the client
    // has. The ack still reports the full allowed set, which is what the
    // client asked about.
    const fresh = subscribe.filter((topic) => !state.subscribed.has(topic));

    // Acked *before* the topics are recorded, so a write that throws (the
    // socket closing mid-write) leaves nothing behind. Recording first wedged
    // the topic permanently: the primes below never started, and every later
    // `sub` was filtered out as "already subscribed" — the same failure the
    // `outcome === "failed"` branch closes on the priming write.
    const ack: ServerAckFrame = { topic: "__ack", data: { subscribed: subscribe, denied } };
    try {
      ws.send(JSON.stringify(ack));
    } catch (error) {
      wsLog.warn("ws ack write failed, leaving the topics unsubscribed: {error}", { error });
      return;
    }
    for (const topic of fresh) state.subscribed.add(topic);

    // Not awaited: the backfills are independent per topic, and one slow query
    // must not delay the others or block the next client frame. `prime` resolves
    // rather than rejects, and the `catch` is the backstop for the impossible
    // case, because nothing is here to receive a rejection.
    for (const topic of fresh) {
      void prime(ws, state, topic).catch((error) => {
        wsLog.warn("ws priming failed for {topic}: {error}", { topic, error });
      });
    }
  };

  /** Handle one already-parsed frame. Runs inside the connection's queue. */
  const handleFrame = async (ws: WsSocket, state: ConnectionState, frame: ClientFrame) => {
    if (!state.open) return;

    if (frame.t === "unsub") {
      for (const topic of resolveUnsubscribe(frame.topics, state.subscribed))
        drop(ws, state, topic);
      return;
    }

    // The gate. Recomputed from the request's headers on every frame.
    const access = await authorize(ws);
    if (!state.open) return;

    // The session granted nothing at all — it expired, or the public dashboard
    // was switched off. Deliberately a close rather than a sweep-and-carry-on:
    // this is the same condition `open` refuses to open on, there is no way
    // back on this connection (every topic is denied from here on, and access
    // is re-read per frame, so a socket that recovers rights would just as
    // happily be a fresh one), and closing is the only answer that is honest
    // to a client which would otherwise sit acked and silent.
    if (!access.dashboard && !access.admin) {
      wsLog.warn("ws access revoked mid-session, closing the connection");
      closeConnection(ws);
      ws.close();
      return;
    }

    sweepRevoked(ws, state, access);
    applySubscribe(ws, state, frame, access);
  };

  return {
    open(ws) {
      // Synchronously, before any await: Elysia does not await this handler, so
      // a `sub` sent from the client's `onopen` is delivered while the
      // authorization round-trips below are still in flight. Registering after
      // them silently dropped that frame.
      const state: ConnectionState = {
        // Deliberately subscribed to nothing: the client says what it wants.
        subscribed: new Set(),
        generation: new Map(),
        pending: new Map(),
        tail: Promise.resolve(),
        open: true,
      };
      connections.set(ws.id, state);

      // Queued rather than awaited inline, so frames that arrive meanwhile are
      // processed *after* the gate has answered instead of racing it.
      return enqueue(state, async () => {
        let access: TopicAccess;
        try {
          access = await authorize(ws);
        } catch (error) {
          // Fail closed. An authorization lookup that throws (the DB is down)
          // says nothing about what this visitor may read, and a connection
          // left half-open would sit there answering frames it was never
          // cleared for.
          wsLog.warn("ws authorization failed, closing the connection: {error}", { error });
          closeConnection(ws);
          ws.close();
          return;
        }
        // Belt-and-braces on top of the macro, matching the five routes this
        // replaces: a connection that may read nothing at all is closed rather
        // than left idling until it asks for something.
        if (!access.dashboard && !access.admin) {
          closeConnection(ws);
          ws.close();
        }
      });
    },

    close(ws) {
      closeConnection(ws);
    },

    message(ws, raw) {
      const state = connections.get(ws.id);
      const frame = parseClientFrame(raw);
      // An unparseable frame is a client defect; closing the socket over it
      // would take the working topics down with it.
      if (!state || !frame) return Promise.resolve();
      return enqueue(state, () => handleFrame(ws, state, frame));
    },
  };

  /**
   * Tear one connection down.
   *
   * Clearing the subscription set and abandoning the in-flight primes is not
   * housekeeping: the priming runs hold this state object directly, so leaving
   * `subscribed` populated kept their "is it still wanted" check answering yes
   * after the socket was gone — the bus listener stayed attached and its buffer
   * grew on every emit, per dead connection, for the life of the process.
   */
  function closeConnection(ws: WsSocket) {
    const state = connections.get(ws.id);
    connections.delete(ws.id);
    if (!state) return;
    state.open = false;
    state.subscribed.clear();
    for (const abandon of state.pending.values()) abandon();
    state.pending.clear();
  }
}
