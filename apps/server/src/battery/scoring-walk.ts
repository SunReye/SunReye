/**
 * The chunked walk over a span of raw history, one chunk at a time.
 *
 * Split out of `./scoring.ts` so the walk is a module with an API rather than a
 * file's private half: `./scoring.ts` (the schedule and the production wiring)
 * is the only production caller, and the walk's own boundary — a chunk that
 * throws must not stop the ones after it — is provable here without a schedule
 * or a Postgres. The geometry it walks is `./scoring-plan.ts`.
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

import type { DischargeSegment } from "./capacity-estimate";
import { interiorSegments, planWindows } from "./scoring-plan";

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

const DEFAULT_PLAN: ChunkPlan = {
  chunkMs: CHUNK_MS,
  overlapMs: OVERLAP_MS,
  marginMs: EDGE_MARGIN_MS,
};

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
