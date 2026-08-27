/**
 * The automations live picture: the `automations` topic on the app's one
 * socket, shared by the index badge and the peak-shaving page.
 *
 * This store used to own a WebSocket of its own, a reconnect loop, a
 * `connected` flag and a `JSON.parse(...) as …`, plus a three-call REST prime
 * (`/status`, `/history`, `/plan`) on every open — the prime existed only
 * because a bare socket had nothing to replay. The multiplexed `/ws` backfills
 * the topic on subscribe with exactly those three facts in one frame, so the
 * prime is gone and with it the race where a slow HTTP answer landed on top of
 * a newer server snapshot. Transport is {@link bus}'s business; what is left
 * here is the domain state, folded by {@link applyAutomationFrame}.
 *
 * "Are we live?" is `bus.connected` now — one answer for the whole app rather
 * than a per-store copy that could disagree with the socket it rode on.
 */

import type { DecisionPoint, PeakShavingPlans, PeakShavingStatus } from "$lib/automations";
import { bus } from "$lib/ws/bus.svelte";
import {
  type AutomationStreamState,
  applyAutomationFrame,
  emptyAutomationStream,
} from "./stream-state";

class AutomationStream {
  /** The whole picture in one `$state`, replaced per frame by the pure fold. */
  #state = $state<AutomationStreamState>(emptyAutomationStream());

  get status(): PeakShavingStatus | null {
    return this.#state.status;
  }

  /** Decision ring, oldest → newest — snapshot-seeded, then grown per tick. */
  get history(): DecisionPoint[] {
    return this.#state.history;
  }

  get plan(): PeakShavingPlans | null {
    return this.#state.plan;
  }

  /** Engine cadence, ms — the countdown base for "next decision in …". */
  get tickMs(): number {
    return this.#state.tickMs;
  }

  /** Client-clock arrival of the newest tick — the countdown anchor. */
  get tickArrivedAt(): number | null {
    return this.#state.tickArrivedAt;
  }

  /** True once the server's snapshot has landed. */
  get loaded(): boolean {
    return this.#state.loaded;
  }

  /**
   * Lease the topic from a component `$effect`; returns the cleanup. Any number
   * of consumers share the one subscription, and none of them touches the
   * socket — the app shell holds that lease.
   */
  lease(): () => void {
    return bus.subscribe("automations", (frame) => {
      this.#state = applyAutomationFrame(this.#state, frame, Date.now());
    });
  }
}

export const automationStream = new AutomationStream();
