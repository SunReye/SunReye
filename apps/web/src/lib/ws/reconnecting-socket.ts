/** Minimal shape of an Eden Treaty WS subscription this helper drives. */
export interface SocketLike {
  subscribe(handler: (message: { data: unknown }) => void): void;
  on(event: "open" | "close" | "error", handler: () => void): void;
  /** Write one frame. Only ever called on an open socket (see {@link ReconnectingSocket.send}). */
  send(data: string): void;
  close(): void;
}

/** Reconnect backoff after an unexpected socket drop. */
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 15_000;

export interface ReconnectingSocketHooks {
  /** Create a fresh socket (called on first lease and on each reconnect). */
  create(): SocketLike;
  /** A message arrived on the current (non-superseded) socket. */
  onMessage(data: unknown): void;
  /**
   * A socket is about to open — reset per-connection state, backfill, etc.
   * A returned promise is awaited before the socket is created, so an HTTP
   * backfill can never be overtaken by the first live push; a rejection is
   * swallowed (a failed backfill is a gap, not a reason to stay offline).
   *
   * `stillWanted()` reports whether this attempt is the one that will open:
   * false once the lease went away (tab hidden, store stopped) or a reopen
   * superseded it. The socket checks it itself before creating the transport,
   * but an async hook's own body runs to completion regardless — so an
   * implementation MUST check it after every await before touching store
   * state, or an abandoned backfill will publish "connecting" over the status
   * the teardown just wrote.
   */
  onStart?(stillWanted: () => boolean): void | Promise<void>;
  /** The current socket finished its handshake. */
  onOpen?(): void;
  /** The connection dropped unexpectedly or the last lease was released. */
  onDrop?(): void;
}

/**
 * Ref-counted WebSocket lease with exponential-backoff reconnect — the shared
 * connection scaffolding of the live stores (EVCC, logs). The socket opens with
 * the first {@link connect} lease and closes with the last; unexpected drops
 * reopen with backoff while at least one lease is live. Handlers of superseded
 * sockets become no-ops, so a late flush can never corrupt store state.
 */
export class ReconnectingSocket {
  #hooks: ReconnectingSocketHooks;
  #leases = 0;
  #ws: SocketLike | null = null;
  #reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  #reconnectAttempts = 0;
  /** Bumped on every close so a pending async start can tell it was abandoned. */
  #generation = 0;
  /** Has the current socket finished its handshake? A browser socket throws on a send before it has. */
  #opened = false;
  /** Frames written before the handshake, flushed in order when it completes. */
  #outbox: string[] = [];

  constructor(hooks: ReconnectingSocketHooks) {
    this.#hooks = hooks;
  }

  /**
   * Lease the live stream from a component `$effect`; returns the cleanup. Any
   * number of consumers share the one connection.
   */
  // fallow-ignore-next-line unused-class-member -- called as `this.#socket.connect()` in the stores; calls through a private-field receiver aren't traced
  connect(): () => void {
    if (this.#leases++ === 0) this.#open();
    // A Svelte cleanup can run twice (a teardown after an explicit release), and
    // every consumer would otherwise have to guard for that itself. An unguarded
    // second call drives the refcount below zero, so `this.#leases++ === 0` above
    // is never true again and the page keeps its dashboard with no socket behind
    // it — for good, and silently.
    let released = false;
    return () => {
      if (released) return;
      released = true;
      if (--this.#leases === 0) this.#teardown();
    };
  }

  #open(): void {
    this.#closeSocket(); // bumps the generation: any in-flight start is abandoned
    const generation = this.#generation;
    // An async start (a backfill fetch) can outlive its own connection attempt:
    // the tab may hide, or a reopen may supersede it, while the fetch is in
    // flight. Only the newest generation may still open — and the hook needs
    // the same answer to decide whether its post-await work is still wanted
    // (see {@link ReconnectingSocketHooks.onStart}).
    //
    // The generation is the whole answer, and "a lease is still held" is not a
    // second condition: every path to zero leases runs `connect`'s disposer ->
    // `#teardown` -> `#closeSocket`, which bumps the generation on the way out.
    // Anding a lease check on top read like defence in depth but could never
    // disagree, so it was a claim no test could hold — and an unpinned
    // condition is worse than none, because the next reader trusts it.
    const stillWanted = (): boolean => this.#generation === generation;
    const started = this.#hooks.onStart?.(stillWanted);
    if (!(started instanceof Promise)) {
      this.#createSocket();
      return;
    }
    const open = (): void => {
      if (!stillWanted()) return;
      this.#createSocket();
    };
    void started.then(open, open);
  }

  /**
   * Write one frame, or hold it until the handshake completes.
   *
   * The multiplexed socket's consumers subscribe to topics whenever they mount,
   * which is routinely while the connection is still opening or reconnecting; a
   * real WebSocket throws on a send in that state. Queued frames belong to the
   * connection attempt in flight — a socket that drops before opening takes them
   * with it (see {@link #dropOutbox}), because the consumer reconciles its own
   * state on the drop and rewrites whatever is still wanted.
   */
  // fallow-ignore-next-line unused-class-member -- called as `this.#socket.send()` in the bus; calls through a private-field receiver aren't traced
  send(data: string): void {
    if (this.#ws !== null && this.#opened) {
      this.#ws.send(data);
      return;
    }
    this.#outbox.push(data);
  }

  #createSocket(): void {
    const ws = this.#hooks.create();
    this.#opened = false;
    ws.subscribe((message: { data: unknown }) => {
      if (this.#ws !== ws) return; // superseded socket flushing late
      this.#hooks.onMessage(message.data);
    });
    ws.on("open", () => {
      if (this.#ws !== ws) return;
      this.#reconnectAttempts = 0; // healthy connection resets backoff
      this.#opened = true;
      // Before `onOpen`: the hook reconciles its subscriptions against what this
      // socket has already been told, so it must see the flushed frames.
      const queued = this.#outbox;
      this.#outbox = [];
      for (const frame of queued) ws.send(frame);
      this.#hooks.onOpen?.();
    });
    ws.on("close", () => {
      if (this.#ws !== ws) return; // intentional/superseded close — don't retry
      this.#ws = null;
      this.#dropOutbox();
      this.#hooks.onDrop?.();
      this.#scheduleReconnect();
    });
    // Surface transport errors as a close so the single reconnect path handles them.
    ws.on("error", () => ws.close());
    this.#ws = ws;
  }

  #scheduleReconnect(): void {
    if (this.#reconnectTimer !== null || this.#leases === 0) return;
    const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** this.#reconnectAttempts);
    this.#reconnectAttempts += 1;
    this.#reconnectTimer = setTimeout(() => {
      this.#reconnectTimer = null;
      if (this.#leases === 0) return;
      this.#open();
    }, delay);
  }

  /**
   * Forget frames written for a connection that is gone.
   *
   * The invariant this keeps: **the outbox is emptied exactly when `onDrop`
   * fires**, because the consumer's `onDrop` forgets what it told the
   * connection, and the two halves must never disagree. A frame the consumer
   * no longer believes it sent is a frame it will never take back — the server
   * stays subscribed to a topic nobody holds, pushing frames the client drops
   * on the floor.
   *
   * Which is why a socket dropping mid-flight does *not* drop what was queued
   * with no socket at all: a topic subscribed to during the outage is waiting
   * for the *next* connection, not for the one that just died, and no `onDrop`
   * has run since it was written.
   */
  #dropOutbox(): void {
    this.#opened = false;
    this.#outbox = [];
  }

  #closeSocket(): void {
    this.#generation += 1; // abandon a start still waiting on its backfill
    const ws = this.#ws;
    this.#ws = null; // drop identity first so its handlers become no-ops
    if (ws !== null) this.#dropOutbox();
    ws?.close();
  }

  #teardown(): void {
    if (this.#reconnectTimer !== null) {
      clearTimeout(this.#reconnectTimer);
      this.#reconnectTimer = null;
    }
    this.#reconnectAttempts = 0;
    // Everything that ends this connection happens before `onDrop`, exactly as
    // on the unexpected-drop path: the socket goes first (`#closeSocket` also
    // abandons a start still waiting on its backfill), then the outbox is
    // emptied unconditionally — `#closeSocket` drops it only when a socket
    // existed, and a lease released mid-outage (or mid-backfill) has none. See
    // {@link #dropOutbox}. `onDrop` runs last and against an empty outbox, so
    // anything the consumer writes from inside it belongs to whatever
    // connection comes next and survives to be flushed there.
    this.#closeSocket();
    this.#dropOutbox();
    this.#hooks.onDrop?.();
  }
}
