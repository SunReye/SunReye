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
 */

import type { InverterProfile } from "@SunReye/inverter-core";
import { measureSegments, recordSegments } from "./health";
import { batteryKeys } from "./keys";

/** How often to look for new segments. */
const SCORE_INTERVAL_MS = 6 * 3_600_000;

/**
 * How far back a routine pass re-measures.
 *
 * Wide enough to contain any single discharge and the gap either side of it,
 * narrow enough that the pass reads a day of raw rather than a year.
 */
const ROUTINE_WINDOW_MS = 3 * 86_400_000;

/** How far back the FIRST pass reaches: the raw retention window. */
const BACKFILL_WINDOW_MS = 1825 * 86_400_000;

interface ScoreResult {
  measured: number;
  stored: number;
}

/** Measure and store one window. Returns zero counts on an unsupported profile. */
async function scoreWindow(
  profile: InverterProfile,
  windowMs: number,
  now: Date = new Date(),
): Promise<ScoreResult> {
  const keys = batteryKeys(profile);
  if (!keys) return { measured: 0, stored: 0 };
  const from = new Date(now.getTime() - windowMs);
  const segments = await measureSegments(profile.id, from, now, keys);
  const stored = await recordSegments(profile.id, segments);
  return { measured: segments.length, stored };
}

/**
 * Start the background scorer: one catch-up pass over history, then a routine
 * pass on a slow tick. Returns a stop function; a no-op on a profile that maps
 * no SOC, so a plant without a battery pays nothing.
 */
export function startBatteryScoring(
  profile: InverterProfile | null,
  log: (message: string) => void = console.log,
): () => void {
  if (!profile || !batteryKeys(profile)) return () => {};

  const pass = async (windowMs: number, label: string) => {
    try {
      const { measured, stored } = await scoreWindow(profile, windowMs);
      if (stored > 0) log(`Battery capacity (${label}): ${stored} of ${measured} segments stored.`);
    } catch (error) {
      // A scoring failure must never take the server down with it: this is a
      // derived statistic, and the next pass is six hours away.
      log(`Battery capacity (${label}) failed: ${String(error)}`);
    }
  };

  void pass(BACKFILL_WINDOW_MS, "backfill");
  const timer = setInterval(() => void pass(ROUTINE_WINDOW_MS, "routine"), SCORE_INTERVAL_MS);
  return () => clearInterval(timer);
}
