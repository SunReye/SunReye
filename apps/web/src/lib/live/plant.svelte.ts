/**
 * Reactive shell over {@link PlantReadings} — the app's canonical "what is true
 * right now" for every measured quantity.
 *
 * Everything that can be wrong lives in `plant.ts` and `ownership.ts`, both
 * plain TS and both tested; runes do not run under `bun test` (see
 * `apps/web/TESTING.md`). This file injects the three things only the reactive
 * layer has — the bus, the manifest's role→key lookup, and a clock — and
 * exposes the readings as `$state`-backed getters.
 *
 * Freshness has to repaint without a frame, which is the one thing a
 * frame-driven store cannot do: a feed that dies produces no event to react to.
 * Hence the ticker, whose only job is to make "no frame for three cadences"
 * observable at all.
 */

import { browser } from "$app/environment";
import { evccStalenessCadenceMs } from "$lib/evcc/feed";
import { evcc } from "$lib/evcc/store.svelte";
import { inverter } from "$lib/inverter/store.svelte";
import type { CanonicalRole } from "$lib/inverter/types";
import { bus } from "$lib/ws/bus.svelte";
import type { LiveValueId, OwningTopic } from "./ownership";
import { PlantFeed, PlantReadings, type Reading, stalenessTickMs } from "./plant";

/** Slowest the staleness clock ticks — a 1 Hz plant should not repaint slower. */
const MIN_TICK_MS = 1000;

class LivePlantStore {
  /** Bumped per frame; readings are recomputed off it. */
  #version = $state(0);
  /** Wall clock, advanced by the ticker so a dying feed becomes visible. */
  #clock = $state(Date.now());
  #timer: ReturnType<typeof setTimeout> | null = null;
  /** Live leases. The ticker is shared, so the last one out stops it. */
  #leases = 0;

  #readings = new PlantReadings({
    // Each feed is judged by its own rhythm: EVCC publishes on MQTT traffic,
    // the rest ride our poll. Collapsing the two would mark a quiet charger
    // dead on a perfectly healthy connection. EVCC's estimate goes through its
    // own floor first — the raw one is clamped to a glide length, which is a
    // different question from how long a number stays true.
    cadenceMs: (topic: OwningTopic) => this.#cadenceMs(topic),
  });

  /**
   * The owning feed's cadence for freshness purposes (ms).
   *
   * Caveat worth knowing: both estimates are EMAs seeded at 1 s (α = 0.3), so
   * on a feed genuinely slower than that the window is too narrow for the first
   * few frames and readings can flash stale just after connect. The EVCC floor
   * removes it there; on the metrics side it needs the *bus* to seed its
   * tracker from the configured poll interval, which is not this module's.
   */
  #cadenceMs(topic: OwningTopic): number {
    return topic === "evcc" ? evccStalenessCadenceMs(evcc.cadenceMs) : bus.cadenceMs;
  }

  #feed = new PlantFeed(this.#readings, {
    subscribe: (topic, on) => bus.subscribe(topic, on),
    // The role→key resolution is the manifest's, and the manifest is the
    // inverter store's. `byRole` already drops metrics the user hid, so a
    // hidden register reads as absent rather than as somebody else's number.
    metricKey: (id) => inverter.byRole(id as CanonicalRole)?.key,
    onChange: () => {
      this.#version += 1;
      this.#clock = Date.now();
    },
  });

  /**
   * The canonical reading of one quantity. Reading it subscribes the caller to
   * both the frame counter and the staleness clock, so a tile re-renders when
   * the number changes *and* when it stops changing.
   */
  read(id: LiveValueId): Reading {
    void this.#version;
    return this.#readings.read(id, this.#clock);
  }

  /**
   * Lease the feeds from a component `$effect`; the disposer gives them back.
   * The bus refcounts both topics, so any number of panels share one
   * subscription and none of them touches the connection.
   */
  lease(): () => void {
    if (!browser) return () => {};
    const release = this.#feed.lease();
    this.#leases += 1;
    // One shared ticker: it is per-store, not per-caller, so a second panel
    // costs nothing.
    if (this.#timer === null) this.#tick();
    let released = false;
    return () => {
      // A Svelte cleanup can run twice; a second decrement would stop the
      // ticker out from under a panel that is still on screen.
      if (released) return;
      released = true;
      release();
      this.#leases -= 1;
      if (this.#leases === 0) this.#stopTicker();
    };
  }

  /**
   * Advance the staleness clock, then schedule the next tick against the
   * cadences as they stand *now*.
   *
   * A `setInterval` fixed at first lease could not do this: both cadence
   * estimates are still their 1 s seed at that moment and only converge over
   * the following frames, so an interval taken then claims to follow the feeds
   * and in fact never leaves 1 Hz. Rescheduling each time re-reads them.
   */
  #tick(): void {
    this.#timer = setTimeout(
      () => {
        this.#clock = Date.now();
        this.#tick();
      },
      stalenessTickMs([this.#cadenceMs("metrics"), this.#cadenceMs("evcc")], MIN_TICK_MS),
    );
  }

  #stopTicker(): void {
    if (this.#timer === null) return;
    clearTimeout(this.#timer);
    this.#timer = null;
  }
}

export const livePlant = new LivePlantStore();
