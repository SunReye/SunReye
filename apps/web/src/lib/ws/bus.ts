/**
 * The app's single live connection.
 *
 * The dashboard used to open one WebSocket per feed — metrics, EVCC,
 * statistics, logs, automations — each store carrying its own copy of the
 * transport, its own reconnect loop and its own untyped `JSON.parse(...) as …`.
 * The server now multiplexes all five over `/ws` (see the server's
 * `routes/ws.ts`), so the browser holds **one** socket and says which topics it
 * wants over it.
 *
 * ## Two independent refcounts, on purpose
 *
 * The *socket* is leased once, by the app shell, and lives as long as the
 * workspace is on screen. *Topics* are refcounted separately, per subscriber.
 * Keeping them apart is what makes "the last card reading a feed goes away, the
 * topic stops, the connection stays" true by construction: if topics shared the
 * socket's lease, navigating off the only page reading EVCC would tear down
 * metrics with it and every other panel would have to reconnect.
 *
 * ## Reconnection is nobody else's business
 *
 * `#sent` records what the *current* connection has been told. A drop clears
 * it, so the next handshake replays every topic that still has a handler as one
 * `sub` frame. No store observes the socket, and none re-subscribes: a store
 * hands over a callback and never thinks about the connection again.
 *
 * Plain TS, no runes: this is the whole mechanism, and runes do not run under
 * `bun test` (see `apps/web/TESTING.md`). `bus.svelte.ts` is the reactive shell
 * that mirrors `connected`/`cadenceMs` into `$state` and injects the real
 * transport.
 */

import type { ClientFrame, WsTopic, WsTopicPayloads } from "@SunReye/contracts/ws";
import { CadenceTracker } from "$lib/inverter/cadence";
import { ReconnectingSocket, type SocketLike } from "./reconnecting-socket";

export interface LiveBusHooks {
  /** Open the transport — `api.ws.subscribe()` in the browser, a fake in tests. */
  create(): SocketLike;
  /** The connection came up or went down. */
  onConnected(connected: boolean): void;
  /** A new estimate of the metrics feed's spacing, in ms. */
  onCadence(cadenceMs: number): void;
  /** Arrival clock, injected so the cadence EMA is testable. Defaults to `Date.now`. */
  now?(): number;
}

/** One subscriber. Wrapped so the same function may be subscribed twice and counted twice. */
interface Subscription {
  on: (data: never) => void;
  onResume?: () => void;
}

/** Per-subscription options. */
export interface SubscribeOptions {
  /**
   * A fresh connection has been established and this topic has been asked for
   * again — anything measured against wall-clock arrivals has to start over.
   *
   * Only the bus knows an outage happened: a topic whose publisher runs on its
   * own loop (EVCC pushes on MQTT traffic, not on our poll) cannot tell a slow
   * period from a dead socket by looking at frame spacing alone.
   */
  onResume?: () => void;
}

/** A server frame reduced to the two fields this module reads. */
interface IncomingFrame {
  topic: string;
  data: unknown;
}

/**
 * The one place a wire payload becomes a value.
 *
 * The transport hands back the raw text; a test double (or a future codec) may
 * hand back the object already. Everything unparseable is dropped rather than
 * thrown — a malformed frame is a server defect, and letting it escape here
 * would take down the message handler for every topic.
 */
function parseFrame(raw: unknown): IncomingFrame | null {
  let value = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (typeof value !== "object" || value === null) return null;
  const { topic, data } = value as { topic?: unknown; data?: unknown };
  if (typeof topic !== "string") return null;
  return { topic, data };
}

export class LiveBus {
  #hooks: LiveBusHooks;
  #socket: ReconnectingSocket;
  /** Topics with at least one live handler. A topic with none has no entry at all. */
  #handlers = new Map<WsTopic, Set<Subscription>>();
  /**
   * Topics the *current* connection has been told about — recorded when the
   * frame is written, not when it goes out, so a `sub` queued behind an
   * unfinished handshake is not written a second time by the open replay.
   * Cleared on every drop: the new connection knows nothing.
   */
  #sent = new Set<WsTopic>();
  /** The device every device-scoped topic is wanted for; `null` is the plant's lead. */
  #deviceId: string | null = null;
  #cadence = new CadenceTracker();

  constructor(hooks: LiveBusHooks) {
    this.#hooks = hooks;
    this.#socket = new ReconnectingSocket({
      create: () => hooks.create(),
      onMessage: (raw) => this.#deliver(raw),
      onOpen: () => {
        // A fresh connection: the gap across the outage is not a poll interval.
        this.#cadence.reset();
        hooks.onConnected(true);
        this.#resume();
        this.#sync();
      },
      onDrop: () => {
        // The new connection knows nothing — not the topics, and not the device
        // they were asked for under. The diff in `#sync` is the replay, and it
        // sends the device with them.
        this.#sent.clear();
        hooks.onConnected(false);
      },
    });
  }

  /**
   * Lease the socket itself. Held once, by the app shell — a page or card wants
   * {@link subscribe} instead.
   */
  // fallow-ignore-next-line unused-class-member -- called as `this.#bus.connect()` from the rune shell; calls through a private-field receiver aren't traced
  connect(): () => void {
    return this.#socket.connect();
  }

  /**
   * Receive one topic's frames until the returned disposer runs. The first
   * subscriber of a topic asks the server for it; the last one to leave gives
   * it back. The connection is untouched either way.
   */
  // fallow-ignore-next-line unused-class-member -- called as `this.#bus.subscribe()` from the rune shell; calls through a private-field receiver aren't traced
  subscribe<K extends WsTopic>(
    topic: K,
    on: (data: WsTopicPayloads[K]) => void,
    options: SubscribeOptions = {},
  ): () => void {
    let subscribers = this.#handlers.get(topic);
    if (!subscribers) {
      subscribers = new Set();
      this.#handlers.set(topic, subscribers);
    }
    const subscription: Subscription = {
      on: on as (data: never) => void,
      onResume: options.onResume,
    };
    subscribers.add(subscription);
    this.#sync();

    let released = false;
    return () => {
      // A Svelte cleanup can run twice (teardown after an explicit release);
      // the second must not give back a topic someone else has since taken.
      if (released) return;
      released = true;
      subscribers.delete(subscription);
      if (subscribers.size === 0) this.#handlers.delete(topic);
      this.#sync();
    };
  }

  /**
   * Point the device-scoped topics at one device; `null` is the plant's lead.
   *
   * Held topics are re-subscribed to it, because the frames already arriving are
   * the previous device's and a panel that kept them would go on painting the
   * old machine. Choosing the device already chosen sends nothing, so a store
   * re-asserting its selection does not re-prime a backfill it already has.
   */
  // fallow-ignore-next-line unused-class-member -- called as `this.#bus.setDevice()` from the rune shell; calls through a private-field receiver aren't traced
  setDevice(deviceId: string | null): void {
    if (deviceId === this.#deviceId) return;
    this.#deviceId = deviceId;
    // Every held topic is now untold: the device is part of what a `sub` says,
    // so the diff below re-sends them under the new one.
    this.#sent.clear();
    this.#sync();
  }

  /**
   * Reconcile what the connection has been told with what is wanted, in at most
   * one frame each way. Every path — a subscribe, a disposer, a handshake —
   * runs this same diff, which is why a reconnect needs no special case: the
   * drop emptied `#sent`, so the diff *is* the replay.
   */
  /**
   * Tell every still-held subscription that a new connection has begun, before
   * its first frame arrives. Iterated over a copy, since a consumer is free to
   * give the topic back from inside its own resume hook.
   */
  #resume(): void {
    for (const subscribers of this.#handlers.values())
      for (const subscription of Array.from(subscribers)) subscription.onResume?.();
  }

  #sync(): void {
    const wanted = new Set(this.#handlers.keys());
    const add = [...wanted].filter((topic) => !this.#sent.has(topic));
    const remove = [...this.#sent].filter((topic) => !wanted.has(topic));
    if (add.length > 0) {
      // Omitted rather than sent as null when there is no chosen device: that is
      // the frame every client sent before devices existed, and the server reads
      // its absence as "the plant's lead".
      this.#send(
        this.#deviceId === null
          ? { t: "sub", topics: add }
          : { t: "sub", topics: add, deviceId: this.#deviceId },
      );
      for (const topic of add) this.#sent.add(topic);
    }
    if (remove.length > 0) {
      this.#send({ t: "unsub", topics: remove });
      for (const topic of remove) this.#sent.delete(topic);
    }
  }

  /** Write a control frame. The socket queues it if the handshake is still running. */
  #send(frame: ClientFrame): void {
    this.#socket.send(JSON.stringify(frame));
  }

  #deliver(raw: unknown): void {
    const frame = parseFrame(raw);
    if (frame === null) return;
    // The clock belongs to the connection, not to a subscriber: a sample that
    // arrived is a sample the poll produced, whoever is looking at it.
    if (frame.topic === "metrics") {
      const now = this.#hooks.now?.() ?? Date.now();
      this.#hooks.onCadence(this.#cadence.sample(now));
    }
    // The lookup is the topic guard: only real topics are ever keys, so an ack
    // frame, an unknown topic, and a topic we just gave back all land here with
    // nothing to call. The server may still be flushing between our `unsub` and
    // its processing of it — that is expected, not an error.
    const subscribers = this.#handlers.get(frame.topic as WsTopic);
    if (!subscribers) return;
    // Snapshot so a handler that (un)subscribes mid-delivery doesn't alter the
    // set being iterated, and isolate each call — one card throwing must not
    // cost the others their frame.
    for (const subscription of Array.from(subscribers)) {
      try {
        // The one cast on the inbound path: `topic` was matched against a real
        // subscriber, and the server pairs topic with payload (`ServerFrame`).
        (subscription.on as (data: unknown) => void)(frame.data);
      } catch {
        // Swallowed on purpose: a throwing handler is a downstream defect,
        // never a reason to drop the frame for everyone else.
      }
    }
  }
}
