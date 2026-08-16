// fallow-ignore-file unused-file -- the ceiling ships with its tested arithmetic before the diagram feeds it; the rails rewrite removes this line
/**
 * The remembered plant peak every rail is measured against, as reactive state.
 *
 * Deliberately thin: the shell owns a `$state` and a `localStorage` key, and
 * nothing else. Every decision — decay, the floor, parsing a corrupt entry —
 * lives in `./flow-pulse`, where `bun test` can reach it.
 */

import { decayCeiling, parseCeiling, type Ceiling } from "./flow-pulse";

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
  #ceiling = $state<Ceiling>(parseCeiling(read()));

  /** The reference watts. Feed to `pulseShare`/`railPulse`. */
  get watts(): number {
    return this.#ceiling.watts;
  }

  /** Fold the plant's current inbound throughput in. Idempotent per instant. */
  observe(instantW: number, nowMs: number = Date.now()): void {
    const next = decayCeiling(this.#ceiling, nowMs, instantW);
    // Only a new peak is written. Decay is a pure function of the stored peak
    // and elapsed time, so persisting the descent would add a 1 Hz synchronous
    // write that a reload could reconstruct anyway.
    if (next.watts > this.#ceiling.watts) persist(next);
    this.#ceiling = next;
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
