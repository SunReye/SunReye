/**
 * The remembered plant peak every rail is measured against, as reactive state.
 *
 * Deliberately thin: the shell owns a `$state` and a `localStorage` key, and
 * nothing else. Every decision — decay, the floor, parsing a corrupt entry —
 * lives in `./flow-pulse`, where `bun test` can reach it.
 *
 * The split between the two fields below is the load-bearing part. `observe()`
 * runs inside the diagram's `$effect`, so anything reactive it READS becomes a
 * dependency of that effect — and it writes on every sample. A `$state`
 * `Ceiling` would therefore reschedule the effect forever and take the whole
 * diagram down at mount with `effect_update_depth_exceeded`. `untrack` does not
 * save it either: `$state` on an object is a deep proxy, so reading `.watts`
 * off the returned value registers the dependency one property deeper.
 */

import { decayCeiling, parseCeiling, shouldPersist, type Ceiling } from "./flow-pulse";

/** This browser's remembered peak. Local: it describes a viewer's session, not the plant's config. */
const KEY = "sunreye.plant-ceiling";

/** Storage can be absent (SSR) or refused (private mode, embedded webview). */
function read(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

class PlantCeiling {
  /** The fold's memory. A plain field on purpose — see the note above. */
  #memory: Ceiling = parseCeiling(read());
  /** What the diagram reads. A number, so a sample that changes nothing writes
   *  nothing: Svelte's `===` check makes the assignment a no-op. */
  #watts = $state(this.#memory.watts);
  /** The last peak actually written, which is not every peak — see
   *  `shouldPersist`. Held apart from the memory because a creep of a watt a
   *  second is a rise on every sample but is worth one write a minute. */
  #written: Ceiling = this.#memory;

  /** The reference watts. Feed to `pulseShare`/`railPulse`. */
  get watts(): number {
    return this.#watts;
  }

  /** Fold the plant's current inbound throughput in. Idempotent per instant. */
  observe(instantW: number, nowMs: number = Date.now()): void {
    const next = decayCeiling(this.#memory, nowMs, instantW);
    if (shouldPersist(this.#written, next)) {
      persist(next);
      this.#written = next;
    }
    this.#memory = next;
    this.#watts = next.watts;
  }
}

function persist(ceiling: Ceiling): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(ceiling));
  } catch {
    // A device that cannot persist it still remembers for this session.
  }
}

export const plantCeiling = new PlantCeiling();
