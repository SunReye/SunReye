/**
 * The background half: keep the capacity estimates current without anyone
 * asking, and catch up on history the first time this runs.
 *
 * A discharge segment deep enough to measure happens at most once or twice a
 * day, so this is a slow tick, not a poll. It re-scores a trailing window rather
 * than only "since last time": a segment that was still in progress when the
 * last pass ran would otherwise be measured truncated and stored that way
 * forever. Re-scoring is free — the segment's end instant is the key, so a
 * second pass over the same night inserts nothing.
 *
 * The first pass covers the whole raw retention window. That is what makes a
 * degradation curve available on the day this ships rather than six months
 * later, and it is only possible because raw is now kept for years rather than
 * days.
 *
 * The walk itself — the chunking that keeps a five-year backfill off the event
 * loop, and the overlap that keeps a straddling discharge whole — lives in
 * `./scoring-walk.ts`. This file is the schedule and the production wiring.
 */

import type { InverterProfile } from "@SunReye/inverter-core";
import { measureSegments, recordSegments } from "./health";
import { batteryKeys } from "./keys";
import {
  BACKFILL_WINDOW_MS,
  ROUTINE_WINDOW_MS,
  scoreSpan,
  type ScoringDeps,
} from "./scoring-walk";

/** How often to look for new segments. */
const SCORE_INTERVAL_MS = 6 * 3_600_000;

/** The database-backed deps for one profile, or null when it maps no battery. */
function productionDeps(
  profile: InverterProfile,
  log: (message: string) => void,
): ScoringDeps | null {
  const keys = batteryKeys(profile);
  if (!keys) return null;
  return {
    measure: (from, to) => measureSegments(profile.id, from, to, keys),
    record: (segments) => recordSegments(profile.id, segments),
    log,
  };
}

/**
 * Start the background scorer: one catch-up pass over history, then a routine
 * pass on a slow tick. Returns a stop function; a no-op on a profile that maps
 * no SOC, so a plant without a battery pays nothing.
 */
export function startBatteryScoring(
  profile: InverterProfile | null,
  log: (message: string) => void = console.log,
  deps: ScoringDeps | null = profile && productionDeps(profile, log),
): () => void {
  if (!profile || !deps || !batteryKeys(profile)) return () => {};
  const wired: ScoringDeps = { ...deps, log: deps.log ?? log };

  const pass = async (windowMs: number, label: string) => {
    const now = (wired.now ?? (() => new Date()))();
    const result = await scoreSpan(wired, now.getTime() - windowMs, now.getTime());
    if (result.stored > 0) {
      log(`Battery capacity (${label}): ${result.stored} of ${result.measured} segments stored.`);
    }
    wired.onPass?.(label, result);
  };

  void pass(BACKFILL_WINDOW_MS, "backfill");
  const timer = setInterval(() => void pass(ROUTINE_WINDOW_MS, "routine"), SCORE_INTERVAL_MS);
  return () => clearInterval(timer);
}
