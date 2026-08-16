/**
 * What arrives on the `evcc` topic, and what the dashboard reads off it.
 *
 * The store itself is a rune shell and cannot be exercised under `bun test`
 * (see `apps/web/TESTING.md`), so everything here that can be wrong — the
 * arrival cadence, the "is there anything to show" test, the charger node's
 * power — is plain TS and lives on this side of the split.
 */

import type { EvccState } from "@SunReye/contracts/evcc";
import { CadenceTracker } from "$lib/inverter/cadence";
import type { WsTopicPayloads } from "@SunReye/contracts/ws";

/**
 * Bounds for the EVCC cadence estimate.
 *
 * Deliberately *not* the metrics feed's (1 s … 1 h): EVCC publishes on change
 * over MQTT rather than on a poll, so the spacing is measured from arrival
 * wall-clock and a retain burst can land frames milliseconds apart. The floor
 * keeps such a burst from collapsing the glide to nothing; the ceiling keeps an
 * idle night from stretching it past any animation worth watching.
 */
const EVCC_CADENCE_BOUNDS = { minMs: 500, maxMs: 10_000 };

export interface EvccFeedHooks {
  /** A fresh snapshot arrived. */
  onState(state: EvccState): void;
  /** A new estimate of the push spacing, in ms. */
  onCadence(cadenceMs: number): void;
  /** Arrival clock, injected so the cadence EMA is testable. Defaults to `performance.now`. */
  now?(): number;
}

/** Folds one `evcc` frame into the shell's reactive fields. */
export class EvccFeed {
  #hooks: EvccFeedHooks;
  #cadence = new CadenceTracker(EVCC_CADENCE_BOUNDS);

  constructor(hooks: EvccFeedHooks) {
    this.#hooks = hooks;
  }

  /**
   * A new connection has begun. The spacing across a dead socket is not a
   * publish interval, and clamping it to {@link EVCC_CADENCE_BOUNDS} still
   * leaves a 10 s glide decaying over the following pushes.
   */
  resume(): void {
    this.#cadence.reset();
  }

  apply(state: EvccState): void {
    // Cadence before state: the glide length is what the new numbers are
    // animated across, so it must already be current when they land.
    this.#hooks.onCadence(this.#cadence.sample(this.#hooks.now?.() ?? performance.now()));
    this.#hooks.onState(state);
  }
}

/** The one method of the live bus this module needs — injected, so the lease is testable. */
export interface EvccTopicBus {
  subscribe(
    topic: "evcc",
    on: (data: WsTopicPayloads["evcc"]) => void,
    options?: { onResume?: () => void },
  ): () => void;
}

/**
 * Take a topic lease on the EVCC feed; the disposer gives it back.
 *
 * Three components hold one of these at once. The bus refcounts the topic, so
 * they cost one `sub` frame between them and the feed only stops when the last
 * of them is gone — no component has to know about the others, and none of them
 * touches the connection.
 */
export function leaseEvcc(bus: EvccTopicBus, feed: EvccFeed): () => void {
  return bus.subscribe("evcc", (data) => feed.apply(data), {
    onResume: () => feed.resume(),
  });
}

/** Integration on + EVCC publishing + at least one loadpoint to show. */
export function isActive(state: EvccState | null): boolean {
  return state !== null && state.reachable && state.loadpoints.length > 0;
}

/**
 * Total charge power across loadpoints (W) — the diagram's charger node.
 * Uses the server's live estimate (feed-forward + house-load residual), which
 * moves at the inverter's 1 Hz cadence instead of EVCC's slow publish loop.
 */
export function totalChargePower(state: EvccState | null): number {
  return (state?.loadpoints ?? []).reduce((sum, lp) => sum + lp.chargePowerLive, 0);
}
