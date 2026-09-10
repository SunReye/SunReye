/**
 * THE CLIENT A `kind = 'mqtt'` CONNECTION OWNS — one per row, shared by
 * everything bound to it, with a status that is OBSERVED rather than inferred.
 *
 * This is the push half of `./connection-tier.ts`'s contract, and the reason it
 * exists is #221: until now nothing owned an MQTT client. The EVCC ingest dialled
 * a module-level singleton, the Home Assistant export dialled another from inside
 * `../inverter/mqtt.ts`, and the settings page could therefore only ever say "a
 * broker id is set" — never "this broker is connected right now". Two integrations
 * on one broker were two TCP connections, two client ids and two LWTs; a broker
 * URL edited on the settings page reached whichever consumer happened to rebuild.
 *
 * WHAT THE POOL IS KEYED BY: the CONNECTION ID, never the URL and never the
 * consumer. That is the whole idea, and the two halves both matter —
 *
 *  - two integrations on one row share ONE client (see {@link acquire}), so the
 *    export and the ingest cost one connection and one subscription set;
 *  - two rows are two clients even when they name the same URL, because #217
 *    made "a second EVCC on a second broker" a row rather than a schema change,
 *    and an operator who split them must get two.
 *
 * THE BACKOFF IS OURS, NOT THE LIBRARY'S. Every dial goes out with
 * `reconnectPeriod: 0` and this module schedules the retry itself, doubling from
 * one second to a minute. The library's own loop is a fixed 1 s retry with no
 * ceiling and no visibility: against the real broker this talks to — a machine in
 * the user's house — a refused connection then becomes a request storm that shows
 * up in nobody's log and never eases off. Ours grows, is capped, resets on a
 * successful connect, and is cancelled the moment the row is released.
 *
 * EVERY COLLABORATOR IS INJECTED — the dial, the timer, the clock — so all of the
 * above is proved against doubles in `./broker-pool.test.ts` with no socket and
 * no wall clock. The production wiring is `./broker-pool-instance.ts`.
 */

import type { MqttParams } from "@SunReye/db/connection-kinds";

import type { ConnectionStatus } from "./connection-tier";

/** An MQTT last will, as the library takes it. */
export interface BrokerWill {
  topic: string;
  payload: string;
  qos: 0 | 1 | 2;
  retain: boolean;
}

/** What a dial is told. `reconnectPeriod` is always 0 — see the header. */
export interface BrokerConnectOptions {
  username?: string | undefined;
  password?: string | undefined;
  clientId?: string | undefined;
  will?: BrokerWill | undefined;
  reconnectPeriod: number;
}

/**
 * The slice of an MQTT client this module drives.
 *
 * Structural, and deliberately small: it is everything the pool needs and
 * nothing a consumer could reach around the pool with. `mqtt`'s `MqttClient`
 * satisfies it.
 */
export interface BrokerClient {
  on(event: "connect" | "close", handler: () => void): void;
  on(event: "error", handler: (error: Error) => void): void;
  on(event: "message", handler: (topic: string, payload: Buffer) => void): void;
  subscribe(topics: string[], callback?: (error?: Error | null) => void): void;
  publish(
    topic: string,
    payload: string,
    options?: Record<string, unknown>,
    callback?: () => void,
  ): void;
  endAsync(): Promise<void>;
}

/** One consumer's interest in a connection's traffic. */
export interface BrokerSubscription {
  /** (Re)subscribed on every connect. Empty for a publish-only consumer. */
  topics?: readonly string[];
  onConnect?(): void;
  onClose?(): void;
  onMessage?(topic: string, payload: Buffer): void;
  /**
   * The broker refused these topics (an ACL, usually).
   *
   * Reported to the SUBSCRIBER rather than logged here, because only the
   * subscriber knows what its own tree failing means — the ingest goes silent,
   * the export merely loses its command path.
   */
  onSubscribeError?(error: Error): void;
}

/**
 * One holder's handle on a connection's client.
 *
 * A holder never sees the client: it subscribes, it publishes, it reads the
 * status, and it releases. That is what makes a re-dial invisible to it — the
 * pool swaps the socket underneath and re-registers what was attached.
 */
export interface BrokerLink {
  readonly connectionId: number;
  /** The endpoint currently dialled — it changes when the row is edited. */
  readonly brokerUrl: string;
  /** Whether the connection is up right now. */
  readonly connected: boolean;
  status(): ConnectionStatus;
  /** Register this holder's interest. One per link; a second call replaces it. */
  subscribe(subscription: BrokerSubscription): void;
  /**
   * Re-point the CONNECTION this holder is on, re-opening it if that changed
   * anything. The holder itself is untouched — its subscription travels.
   *
   * Distinct from a second {@link BrokerPool.acquire}, which would add a holder:
   * the tier re-applies its row on every pass, and a pass-per-settings-save that
   * leaked a holder would make the client unclosable.
   */
  update(params: MqttParams, options?: { will?: BrokerWill }): void;
  publish(
    topic: string,
    payload: string,
    options?: Record<string, unknown>,
    callback?: () => void,
  ): void;
  /** Give the handle back. The client closes when the last holder does. */
  release(): Promise<void>;
}

export interface BrokerPool {
  /**
   * The client for this connection, opening or re-opening it as its params
   * demand. Every call is a new holder and must be released.
   */
  acquire(connectionId: number, params: MqttParams, options?: { will?: BrokerWill }): BrokerLink;
  /** What is OBSERVED of this connection, or null when nothing holds it. */
  status(connectionId: number): ConnectionStatus | null;
  /** Release every client (graceful shutdown). */
  close(): Promise<void>;
}

/** A timer, injected so the backoff is testable without a wall clock. */
export type Schedule = (run: () => void, ms: number) => () => void;

export interface BrokerPoolLogger {
  info(template: string, values?: Record<string, unknown>): void;
  warn(template: string, values?: Record<string, unknown>): void;
  error(template: string, values?: Record<string, unknown>): void;
}

export interface BrokerPoolDeps {
  dial(url: string, options: BrokerConnectOptions): BrokerClient;
  schedule: Schedule;
  now?: () => Date;
  logger?: BrokerPoolLogger;
}

/** First retry delay, and the ceiling it doubles up to. */
const RETRY_BASE_MS = 1000;
const RETRY_MAX_MS = 60_000;

const NO_LOG: BrokerPoolLogger = { info: () => {}, warn: () => {}, error: () => {} };

/** Whether two brokers address the same endpoint with the same credentials. */
function sameParams(a: MqttParams, b: MqttParams): boolean {
  return (
    a.brokerUrl === b.brokerUrl &&
    a.username === b.username &&
    a.password === b.password &&
    a.clientId === b.clientId
  );
}

/** Whether two last wills would produce the same CONNECT packet. */
function sameWill(a: BrokerWill | undefined, b: BrokerWill | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return a.topic === b.topic && a.payload === b.payload && a.qos === b.qos && a.retain === b.retain;
}

interface Holder {
  subscription: BrokerSubscription | null;
}

/** One connection's client, its holders, and everything observed about it. */
interface Entry {
  params: MqttParams;
  will: BrokerWill | undefined;
  client: BrokerClient | null;
  holders: Set<Holder>;
  connected: boolean;
  lastError: string | null;
  lastErrorAt: string | null;
  lastConnectedAt: string | null;
  /** Consecutive failed dials — the backoff exponent. */
  attempts: number;
  cancelRetry: (() => void) | null;
  /** Set while WE are closing, so the resulting `close` schedules no retry. */
  closing: boolean;
}

export function createBrokerPool(deps: BrokerPoolDeps): BrokerPool {
  const logger = deps.logger ?? NO_LOG;
  const now = deps.now ?? (() => new Date());
  const entries = new Map<number, Entry>();

  const statusOf = (entry: Entry): ConnectionStatus => ({
    connected: entry.connected,
    lastError: entry.lastError,
    lastErrorAt: entry.lastErrorAt,
    lastConnectedAt: entry.lastConnectedAt,
  });

  /** Register one holder's topics on the live client, reporting a refusal to it. */
  function subscribeHolder(entry: Entry, holder: Holder): void {
    const topics = holder.subscription?.topics;
    if (!entry.client || !topics || topics.length === 0) return;
    const subscription = holder.subscription;
    entry.client.subscribe([...topics], (error) => {
      if (error) subscription?.onSubscribeError?.(error);
    });
  }

  function scheduleRetry(connectionId: number, entry: Entry): void {
    if (entry.cancelRetry) return;
    const delay = Math.min(RETRY_BASE_MS * 2 ** entry.attempts, RETRY_MAX_MS);
    entry.attempts += 1;
    entry.cancelRetry = deps.schedule(() => {
      entry.cancelRetry = null;
      // The row may have been released while the timer was pending.
      if (entries.get(connectionId) !== entry) return;
      dial(connectionId, entry);
    }, delay);
  }

  /** Drop a client without letting its own `close` look like a lost connection. */
  async function discard(entry: Entry): Promise<void> {
    const previous = entry.client;
    entry.client = null;
    entry.connected = false;
    if (!previous) return;
    await previous.endAsync();
  }

  function dial(connectionId: number, entry: Entry): void {
    const client = deps.dial(entry.params.brokerUrl, {
      username: entry.params.username,
      password: entry.params.password,
      clientId: entry.params.clientId,
      will: entry.will,
      // See the header: the retry loop below is ours, and two loops against one
      // refusing broker is exactly the storm this replaces.
      reconnectPeriod: 0,
    });
    entry.client = client;
    client.on("connect", () => {
      if (entry.client !== client) return;
      entry.connected = true;
      entry.attempts = 0;
      entry.lastError = null;
      entry.lastErrorAt = null;
      entry.lastConnectedAt = now().toISOString();
      for (const holder of entry.holders) {
        subscribeHolder(entry, holder);
        holder.subscription?.onConnect?.();
      }
      logger.info("connection {id} is connected to {brokerUrl}", {
        id: connectionId,
        brokerUrl: entry.params.brokerUrl,
      });
    });
    client.on("close", () => {
      // A client we have already replaced or ended is not this connection's
      // state any more: reacting would flap the status and stack up retries.
      if (entry.client !== client || entry.closing) return;
      entry.connected = false;
      for (const holder of entry.holders) holder.subscription?.onClose?.();
      scheduleRetry(connectionId, entry);
    });
    client.on("error", (error: Error) => {
      if (entry.client !== client) return;
      entry.lastError = error instanceof Error ? error.message : String(error);
      entry.lastErrorAt = now().toISOString();
      logger.error("connection {id} client error: {error}", { id: connectionId, error });
    });
    client.on("message", (topic: string, payload: Buffer) => {
      if (entry.client !== client) return;
      for (const holder of entry.holders) holder.subscription?.onMessage?.(topic, payload);
    });
  }

  /**
   * Re-open with new params or a new will, keeping every holder attached.
   *
   * The holders are the point: a settings save that re-points a broker must not
   * make each consumer notice and re-register, because a consumer that forgot to
   * would go silent with a status still reading "connected".
   */
  async function redial(connectionId: number, entry: Entry): Promise<void> {
    entry.closing = true;
    await discard(entry);
    entry.closing = false;
    if (entries.get(connectionId) !== entry) return;
    entry.attempts = 0;
    dial(connectionId, entry);
  }

  async function closeEntry(connectionId: number, entry: Entry): Promise<void> {
    entry.closing = true;
    entry.cancelRetry?.();
    entry.cancelRetry = null;
    entries.delete(connectionId);
    await discard(entry);
  }

  /**
   * Apply a row's current params (and any declared will) to a live entry,
   * re-dialling only when the CONNECT packet would differ.
   *
   * The "only when it differs" half is the behaviour, not an optimisation: the
   * settings page saves the whole document, so re-dialling per save would drop
   * every retained subscription and flap the LWT on a broker nobody edited.
   */
  function reopen(
    connectionId: number,
    entry: Entry,
    params: MqttParams,
    options?: { will?: BrokerWill },
  ): void {
    // A holder that declares no will must never STRIP the one the Home
    // Assistant export set: it would silently take the LWT off a live export,
    // and Home Assistant would then show the last value of a dead bridge.
    const nextWill = options?.will ?? entry.will;
    const changed = !sameParams(entry.params, params) || !sameWill(entry.will, nextWill);
    entry.params = params;
    entry.will = nextWill;
    // Fire-and-forget: the caller is answered synchronously, and a link
    // publishes onto whatever client the entry holds at the time.
    if (changed) void redial(connectionId, entry);
  }

  function acquire(
    connectionId: number,
    params: MqttParams,
    options?: { will?: BrokerWill },
  ): BrokerLink {
    let entry = entries.get(connectionId);
    if (!entry) {
      entry = {
        params,
        will: options?.will,
        client: null,
        holders: new Set(),
        connected: false,
        lastError: null,
        lastErrorAt: null,
        lastConnectedAt: null,
        attempts: 0,
        cancelRetry: null,
        closing: false,
      };
      entries.set(connectionId, entry);
      dial(connectionId, entry);
    } else {
      reopen(connectionId, entry, params, options);
    }

    const held = entry;
    const holder: Holder = { subscription: null };
    held.holders.add(holder);
    let released = false;

    return {
      connectionId,
      get brokerUrl() {
        return held.params.brokerUrl;
      },
      get connected() {
        return held.connected;
      },
      status: () => statusOf(held),
      update(nextParams, nextOptions) {
        if (entries.get(connectionId) !== held) return;
        reopen(connectionId, held, nextParams, nextOptions);
      },
      subscribe(subscription) {
        holder.subscription = subscription;
        // A consumer joining a client that is ALREADY up would otherwise wait
        // for a reconnect that may never come. One that joins before the
        // handshake is registered by the `connect` handler instead — doing both
        // would subscribe its tree twice.
        if (!held.connected) return;
        subscribeHolder(held, holder);
        subscription.onConnect?.();
      },
      publish(topic, payload, publishOptions, callback) {
        held.client?.publish(topic, payload, publishOptions, callback);
      },
      async release() {
        if (released) return;
        released = true;
        held.holders.delete(holder);
        if (held.holders.size === 0 && entries.get(connectionId) === held) {
          await closeEntry(connectionId, held);
        }
      },
    };
  }

  return {
    acquire,
    status: (connectionId) => {
      const entry = entries.get(connectionId);
      return entry ? statusOf(entry) : null;
    },
    async close() {
      // A COPY: `closeEntry` deletes from the map it is being iterated over.
      for (const [connectionId, entry] of Array.from(entries)) {
        await closeEntry(connectionId, entry);
      }
    },
  };
}
