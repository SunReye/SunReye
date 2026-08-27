/**
 * One canonical reading per quantity, with its freshness.
 *
 * `ownership.ts` says who may produce a number; this is where that number is
 * kept and where "is it still true?" gets an answer. Consumers ask for a
 * {@link Reading} and get both facts at once, because the two are only useful
 * together: a value with no age behind it is what let a 30 s decision ride a
 * 1 Hz animation and look current.
 *
 * Three facts, kept apart on purpose:
 *
 * - **absent** — the owner has never reported this. A profile without the role,
 *   a charger that is not there. Nothing has aged, so nothing is stale.
 * - **stale** — the owner reported it, and then stopped. The value is still
 *   handed over (what was last true is worth showing) but {@link animatable}
 *   withholds it from the glide, because animating it is the lie.
 * - **current** — reported within roughly three of the owner's own cadences.
 *
 * Plain TS, no runes: this is the whole mechanism, and runes do not run under
 * `bun test` (see `apps/web/TESTING.md`). `plant.svelte.ts` is the reactive
 * shell that injects the real bus and the manifest's role lookup.
 */

import type { EvccState } from "@SunReye/contracts/evcc";
import type { WsTopicPayloads } from "@SunReye/contracts/ws";
import { isActive, totalChargePower } from "$lib/evcc/feed";
import { type LiveValueId, type OwnedBy, type OwningTopic, OWNERSHIP, ownerOf } from "./ownership";

/**
 * How many of the owner's cadences a reading survives before it counts as
 * stale. Three, not one: a single late frame is a jittery poll, not an outage,
 * and marking every hiccup stale would train the reader to ignore the marker.
 */
const STALE_AFTER_CADENCES = 3;

/** A canonical value and whether it is still current. */
export interface Reading {
  /** The number, or `undefined` when the owner has never reported one. */
  value: number | undefined;
  /** No frame for roughly {@link STALE_AFTER_CADENCES} of the owner's cadences. */
  stale: boolean;
}

/** Absent: nothing to show, and nothing that could have aged. */
const ABSENT: Reading = { value: undefined, stale: false };

/**
 * The value only while it is genuinely current — what may ride `AnimatedNumber`.
 * A stale number must not wear a live animation; that is the bug this phase
 * closes, stated as a function.
 */
export function animatable(reading: Reading): number | undefined {
  return reading.stale ? undefined : reading.value;
}

/**
 * One reading as a label: the number when there is one, an em dash when there
 * is not, and the number plus a marker when it has stopped being refreshed.
 *
 * The em dash is deliberate. Falling back to another topic's number is what
 * this phase removes, and the replacement is not a cleverer guess — it is an
 * admission. `staleLabel` is passed in so this stays free of the i18n runtime.
 */
export function formatReading(
  reading: Reading,
  format: (value: number) => string,
  staleLabel: string,
): string {
  if (reading.value === undefined) return "—";
  return reading.stale ? `${format(reading.value)} · ${staleLabel}` : format(reading.value);
}

/**
 * How often the staleness clock has to tick, given every owner's cadence (ms).
 *
 * A reading expires at {@link STALE_AFTER_CADENCES} of its owner's cadence, so
 * the clock must tick no slower than the *shortest* cadence in play or the
 * soonest expiry goes unseen — an hourly metrics poll must not set the pace for
 * a charger judged in tens of seconds. Ticking any faster buys nothing but
 * repaints: every tick invalidates every tile, and on that hourly poll a
 * per-second one would do it 3 600 times between two samples. `minMs` is the
 * other end — a 1 Hz plant should repaint at 1 Hz.
 */
export function stalenessTickMs(cadences: readonly number[], minMs: number): number {
  // `Math.min()` of nothing is Infinity, which would park the ticker forever.
  if (cadences.length === 0) return minMs;
  return Math.max(minMs, Math.min(...cadences));
}

export interface PlantReadingsHooks {
  /** The owning feed's own spacing (ms) — EVCC's is not the metrics poll's. */
  cadenceMs(topic: OwningTopic): number;
}

/** One observation: the number and the client-clock moment it arrived. */
interface Observation {
  value: number;
  atMs: number;
}

/** The canonical reading of every quantity the dashboard shows. */
export class PlantReadings {
  #hooks: PlantReadingsHooks;
  #observed = new Map<LiveValueId, Observation>();

  constructor(hooks: PlantReadingsHooks) {
    this.#hooks = hooks;
  }

  /**
   * Record what a topic reports for a value it owns. `undefined` clears the
   * entry — a register that stopped being reported is absent, never frozen at
   * its last value.
   *
   * Returns whether the report was accepted. A cross-topic write is refused
   * rather than thrown: the types already forbid it, and a runtime throw inside
   * a frame handler would cost every other value in that frame. The refusal is
   * the belt to the type system's braces.
   */
  // fallow-ignore-next-line unused-class-member -- called as `this.#readings.x()` / `this.#feed.x()` from the rune shell; calls through a private-field receiver aren't traced
  observe<T extends OwningTopic>(
    topic: T,
    id: OwnedBy<T>,
    value: number | undefined,
    atMs: number,
  ): boolean {
    if (ownerOf(id) !== topic) return false;
    if (value === undefined) this.#observed.delete(id);
    else this.#observed.set(id, { value, atMs });
    return true;
  }

  /** The canonical reading, judged against its owner's cadence. */
  // fallow-ignore-next-line unused-class-member -- called as `this.#readings.x()` / `this.#feed.x()` from the rune shell; calls through a private-field receiver aren't traced
  read(id: LiveValueId, nowMs: number): Reading {
    const observation = this.#observed.get(id);
    if (!observation) return ABSENT;
    const window = this.#hooks.cadenceMs(ownerOf(id)) * STALE_AFTER_CADENCES;
    return { value: observation.value, stale: nowMs - observation.atMs > window };
  }
}

/** The one bus method this module needs — injected, so the wiring is testable. */
export interface PlantTopicBus {
  subscribe<K extends "metrics" | "evcc">(
    topic: K,
    on: (data: WsTopicPayloads[K]) => void,
  ): () => void;
}

export interface PlantFeedHooks extends PlantTopicBus {
  /**
   * The manifest's metric key for a canonical role, or `undefined` when this
   * profile maps no register to it. Injected because the manifest lives in the
   * inverter store, which is a rune shell.
   */
  metricKey(id: LiveValueId): string | undefined;
  /** A frame landed; the reactive shell repaints. */
  onChange(): void;
  /** Arrival clock, injected so freshness is testable. Defaults to `Date.now`. */
  now?(): number;
}

/**
 * Folds the owning topics' frames into {@link PlantReadings}.
 *
 * Metrics and EVCC only: those two carry measured quantities that more than one
 * card wants. The automations and statistics topics own values too, but each
 * has exactly one consumer that already reads them from their owner, and
 * copying them here would add a second place they can be read from — which is
 * the very thing this phase removes.
 */
export class PlantFeed {
  #readings: PlantReadings;
  #hooks: PlantFeedHooks;

  constructor(readings: PlantReadings, hooks: PlantFeedHooks) {
    this.#readings = readings;
    this.#hooks = hooks;
  }

  /**
   * Take the topic leases; the disposer gives them back. Both topics are
   * refcounted by the bus, so holding them here costs no extra socket traffic
   * next to the shell's own metrics lease.
   */
  // fallow-ignore-next-line unused-class-member -- called as `this.#readings.x()` / `this.#feed.x()` from the rune shell; calls through a private-field receiver aren't traced
  lease(): () => void {
    const disposers = [
      this.#hooks.subscribe("metrics", (sample) => this.#applyMetrics(sample)),
      this.#hooks.subscribe("evcc", (state) => this.#applyEvcc(state)),
    ];
    let released = false;
    return () => {
      // A Svelte cleanup can run twice (teardown after an explicit release);
      // the second must not give back a topic a later lease has since taken.
      if (released) return;
      released = true;
      for (const dispose of disposers) dispose();
    };
  }

  #now(): number {
    return this.#hooks.now?.() ?? Date.now();
  }

  #applyMetrics(sample: WsTopicPayloads["metrics"]): void {
    const at = this.#now();
    for (const id of OWNERSHIP.metrics) {
      const key = this.#hooks.metricKey(id);
      // An unmapped role and a mapped-but-unsampled register are the same fact
      // to a reader: this plant has no number for that. Neither is a reason to
      // go looking at another topic.
      this.#readings.observe("metrics", id, key ? sample.metrics[key] : undefined, at);
    }
    this.#hooks.onChange();
  }

  #applyEvcc(state: EvccState): void {
    // No integration, no loadpoint, nothing reachable: "nothing to say", which
    // is a different claim from "the car is drawing 0 W".
    const power = isActive(state) ? totalChargePower(state) : undefined;
    this.#readings.observe("evcc", "evcc.charge.power", power, this.#now());
    this.#hooks.onChange();
  }
}
