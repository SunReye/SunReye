/**
 * The automations LIVE picture: the `automations` topic on the app's one socket,
 * shared by the index badge and the peak-shaving page.
 *
 * Live, and only live. This store used to carry the engine's decision history
 * too — a 2 880-point ring the server held in memory and replayed over the
 * socket on every subscribe. The optimizer is a device now, so its decisions are
 * rows in `metrics_raw` read through `/api/history/rollup` by whichever chart
 * wants them, and what is left here is the engine STATE (blockers, errors, the
 * countdown) and the FORECAST — the two things that are not measurements and
 * therefore have nowhere else to come from.
 *
 * "Are we live?" is `bus.connected` — one answer for the whole app rather than a
 * per-store copy that could disagree with the socket it rode on.
 */

import type { PeakShavingPlans, PeakShavingStatus } from "$lib/automations";
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

  /** True once the server's first frame has landed. */
  get loaded(): boolean {
    return this.#state.loaded;
  }

  /**
   * When the engine last decided anything, as the server stamped it — the cue a
   * chart re-reads the optimizer's stored series on.
   *
   * A STAMP rather than a signal: a component that re-fetches when this value
   * changes refetches once per decision, and a reconnect that replays the same
   * frame changes nothing and costs nothing.
   */
  get lastTickAt(): string | null {
    return this.#state.status?.lastTickAt ?? null;
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
