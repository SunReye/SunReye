import type { EvccLoadpoint, EvccState } from "server/src/evcc";
import { api } from "$lib/api";
import * as m from "$lib/paraglide/messages";
import { ReconnectingSocket } from "$lib/ws/reconnecting-socket";

export type { EvccLoadpoint };

export type EvccMode = "off" | "pv" | "minpv" | "now";

/** EVCC charge modes with their display labels, in EVCC's own UI order. */
export const EVCC_MODES: { value: EvccMode; label: () => string }[] = [
  { value: "off", label: m.evcc_mode_off },
  { value: "pv", label: m.evcc_mode_pv },
  { value: "minpv", label: m.evcc_mode_minpv },
  { value: "now", label: m.evcc_mode_now },
];

/**
 * Server-held EVCC state on the client, streamed over a WebSocket. The server
 * ingests EVCC's MQTT push, coalesces it, and broadcasts each fresh snapshot;
 * the socket's `open` handler also sends the current snapshot so a new
 * subscriber paints immediately. Consumers (power-flow diagram, EV card) each
 * hold a {@link connect} lease from an `$effect`; the socket is open while at
 * least one lease is live ({@link ReconnectingSocket}).
 *
 * An initial `GET /api/evcc` fetch on each (re)open covers the brief window
 * before the socket handshake completes, so the first paint never waits on
 * the WS and a reconnect backfills the gap.
 */
class EvccStore {
  state = $state<EvccState | null>(null);
  /** True once the first snapshot (fetch or socket) has arrived. */
  loaded = $state(false);

  /**
   * Exponentially-smoothed gap between live EVCC pushes (ms). EVCC publishes on
   * change rather than on a fixed poll, so this is measured from arrival
   * wall-clock and seeds at 1 s. `AnimatedNumber` stretches its glide across it
   * so EVCC-fed numbers (charge power, session energy) drift continuously
   * between pushes instead of snapping and freezing — same treatment the
   * inverter feed gets, but keyed to EVCC's own cadence. See {@link cadenceMs}.
   */
  cadenceMs = $state(1000);
  /** Arrival time of the previous live push; drives the cadence estimate. */
  #lastPushAt: number | null = null;

  #socket = new ReconnectingSocket({
    create: () => api.ws.evcc.subscribe(),
    onStart: () => {
      // Fresh connection: don't measure a gap against a pre-(re)connect
      // timestamp, and backfill over any offline window.
      this.#lastPushAt = null;
      void this.#refresh();
    },
    onMessage: (raw) => {
      // Track spacing between pushes (arrival wall-clock — EVCC has no per-sample
      // poll timestamp). EMA (α=0.3) so a bursty push doesn't whip it; clamp to a
      // sane display range so a long quiet spell doesn't stretch the glide forever.
      const now = performance.now();
      if (this.#lastPushAt !== null) {
        const clamped = Math.min(10_000, Math.max(500, now - this.#lastPushAt));
        this.cadenceMs = this.cadenceMs * 0.7 + clamped * 0.3;
      }
      this.#lastPushAt = now;
      this.#apply((typeof raw === "string" ? JSON.parse(raw) : raw) as EvccState | null);
    },
  });

  /** Integration on + EVCC publishing + at least one loadpoint to show. */
  get active(): boolean {
    const s = this.state;
    return s !== null && s.reachable && s.loadpoints.length > 0;
  }

  get loadpoints(): EvccLoadpoint[] {
    return this.state?.loadpoints ?? [];
  }

  /** Total charge power across loadpoints (W) — the diagram's charger node. */
  get chargePower(): number {
    return this.loadpoints.reduce((sum, lp) => sum + lp.chargePower, 0);
  }

  #apply(next: EvccState | null): void {
    this.state = next;
    this.loaded = true;
  }

  /** One-shot HTTP read for the first paint (and the post-reconnect backfill). */
  async #refresh(): Promise<void> {
    const { data, error } = await api.api.evcc.get();
    if (error) return; // Transient: keep the last snapshot.
    this.#apply((data as EvccState | null) ?? null);
  }

  /**
   * Lease the live stream from a component `$effect`; returns the cleanup. Any
   * number of consumers share one connection.
   */
  connect(): () => void {
    return this.#socket.connect();
  }

  /** Send a loadpoint command; state converges via EVCC's republish over WS. */
  async #command(
    body:
      | { loadpoint: number; action: "mode"; value: EvccMode }
      | { loadpoint: number; action: "limitSoc"; value: number },
  ): Promise<string | null> {
    const { error } = await api.api.commands.evcc.post(body);
    if (error) {
      const detail = error.value as { error?: string } | null;
      return detail?.error ?? `Command failed (${error.status})`;
    }
    return null;
  }

  setMode(loadpoint: number, mode: EvccMode): Promise<string | null> {
    return this.#command({ loadpoint, action: "mode", value: mode });
  }

  setLimitSoc(loadpoint: number, limit: number): Promise<string | null> {
    return this.#command({ loadpoint, action: "limitSoc", value: limit });
  }
}

export const evcc = new EvccStore();
