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
 * ## Why the pass is chunked
 *
 * It used to be one read of the whole window and one synchronous segmentation
 * of it. On an install whose 1.2.0 -> 2.0.0 backfill had just carried months of
 * raw into `metrics_raw`, that pass never finished — the event loop was gone,
 * `/healthz` stopped answering, and the Supervisor watchdog restarted the addon
 * every few minutes, which started the same pass again (seen live 2026-09-09).
 * So the window is walked in {@link CHUNK_MS} pieces, ONE AT A TIME: each chunk is
 * a bounded read and a bounded segmentation, and the `await` between chunks is
 * where every request that queued up behind it gets answered.
 *
 * Chunks OVERLAP by {@link OVERLAP_MS}, longer than any one discharge, and a
 * segment that touches a chunk's cut edge is not recorded from that chunk — the
 * neighbour that contains it whole records it instead ({@link interiorSegments}).
 * Without that, a night discharge straddling a cut would be stored truncated,
 * under its own end instant, as a real estimate.
 */

import type { InverterProfile } from "@SunReye/inverter-core";
import type { DischargeSegment } from "./capacity-estimate";
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
export const ROUTINE_WINDOW_MS = 3 * 86_400_000;

/** How far back the FIRST pass reaches: the raw retention window. */
export const BACKFILL_WINDOW_MS = 1825 * 86_400_000;

/** One read of raw, and one synchronous segmentation, is at most this wide. */
const CHUNK_MS = 7 * 86_400_000;

/** Longer than any one discharge, so no segment is cut by BOTH of its chunks. */
const OVERLAP_MS = 86_400_000;

/**
 * A segment ending closer than this to a chunk's cut edge may have been cut
 * short. Equal to the gap that breaks a segment anyway (`MAX_GAP_MS` in
 * ./capacity-estimate): a segment that ended further than this from the edge
 * ended because the data said so, not because the read stopped.
 */
const EDGE_MARGIN_MS = 15 * 60_000;

export interface Window {
  from: number;
  to: number;
}

export interface ScoreResult {
  measured: number;
  stored: number;
}

/**
 * What a pass needs from the outside. Production wires the database halves
 * (`./health`); the tests hand in doubles, so the walk — its order, its overlap,
 * its one-at-a-time-ness — is provable without a Postgres.
 */
export interface ScoringDeps {
  measure: (from: Date, to: Date) => Promise<DischargeSegment[]>;
  record: (segments: readonly DischargeSegment[]) => Promise<number>;
  log?: (message: string) => void;
  now?: () => Date;
  /** Called after each pass completes, with its label. Tests await this. */
  onPass?: (label: string, result: ScoreResult) => void;
}

export interface ChunkPlan {
  chunkMs: number;
  overlapMs: number;
  marginMs: number;
}

const DEFAULT_PLAN: ChunkPlan = { chunkMs: CHUNK_MS, overlapMs: OVERLAP_MS, marginMs: EDGE_MARGIN_MS };

/**
 * Split `[from, to)` into chunks of at most `chunkMs`, each starting `overlapMs`
 * before the previous one ended. The first starts at `from`, the last ends at
 * `to`, and an empty span is no chunks.
 */
export function planWindows(from: number, to: number, chunkMs: number, overlapMs: number): Window[] {
  if (overlapMs >= chunkMs) throw new Error("chunk overlap must be shorter than the chunk");
  const windows: Window[] = [];
  let start = from;
  while (start < to) {
    const end = Math.min(start + chunkMs, to);
    windows.push({ from: start, to: end });
    if (end >= to) break;
    start = end - overlapMs;
  }
  return windows;
}

/**
 * The segments of one chunk that are safe to record from it: those not touching
 * a cut edge. The span's own edges are real edges — the data really does start
 * and stop there — so a segment against them is kept.
 */
export function interiorSegments(
  segments: readonly DischargeSegment[],
  window: Window,
  span: Window,
  marginMs: number,
): DischargeSegment[] {
  const cutBelow = window.from > span.from;
  const cutAbove = window.to < span.to;
  return segments.filter(
    (s) =>
      !(cutBelow && s.startMs < window.from + marginMs) &&
      !(cutAbove && s.endMs > window.to - marginMs),
  );
}

/**
 * Score `[from, to)` one chunk at a time. A chunk that fails is logged and
 * skipped — a derived statistic must not stop the walk, let alone the server —
 * and the rest are still scored.
 */
export async function scoreSpan(
  deps: ScoringDeps,
  from: number,
  to: number,
  plan: ChunkPlan = DEFAULT_PLAN,
): Promise<ScoreResult> {
  const span = { from, to };
  const result: ScoreResult = { measured: 0, stored: 0 };
  for (const window of planWindows(from, to, plan.chunkMs, plan.overlapMs)) {
    try {
      const found = await deps.measure(new Date(window.from), new Date(window.to));
      const keep = interiorSegments(found, window, span, plan.marginMs);
      result.measured += keep.length;
      if (keep.length > 0) result.stored += await deps.record(keep);
    } catch (error) {
      deps.log?.(
        `Battery capacity: chunk ${new Date(window.from).toISOString()} .. ` +
          `${new Date(window.to).toISOString()} failed: ${String(error)}`,
      );
    }
  }
  return result;
}

/** The database-backed deps for one profile, or null when it maps no battery. */
function productionDeps(profile: InverterProfile, log: (message: string) => void): ScoringDeps | null {
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
