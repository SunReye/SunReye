/** Minimal shape of an Eden Treaty WS subscription this helper drives. */
export interface SocketLike {
  subscribe(handler: (message: { data: unknown }) => void): void;
  on(event: "open" | "close" | "error", handler: () => void): void;
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
  /** A socket is about to open — reset per-connection state, backfill, etc. */
  onStart?(): void;
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
    return () => {
      if (--this.#leases === 0) this.#teardown();
    };
  }

  #open(): void {
    this.#closeSocket();
    this.#hooks.onStart?.();
    const ws = this.#hooks.create();
    ws.subscribe((message: { data: unknown }) => {
      if (this.#ws !== ws) return; // superseded socket flushing late
      this.#hooks.onMessage(message.data);
    });
    ws.on("open", () => {
      if (this.#ws !== ws) return;
      this.#reconnectAttempts = 0; // healthy connection resets backoff
      this.#hooks.onOpen?.();
    });
    ws.on("close", () => {
      if (this.#ws !== ws) return; // intentional/superseded close — don't retry
      this.#ws = null;
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

  #closeSocket(): void {
    const ws = this.#ws;
    this.#ws = null; // drop identity first so its handlers become no-ops
    ws?.close();
  }

  #teardown(): void {
    if (this.#reconnectTimer !== null) {
      clearTimeout(this.#reconnectTimer);
      this.#reconnectTimer = null;
    }
    this.#reconnectAttempts = 0;
    this.#hooks.onDrop?.();
    this.#closeSocket();
  }
}
