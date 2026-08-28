/**
 * THE BACKFILL'S ARITHMETIC: everything it decides without touching a database.
 *
 * Split from `./backfill-run.ts` on the same line this package already draws
 * between `./upgrade-120.ts` and `./upgrade-120-run.ts`, and between `./replay.ts`
 * and `./replay-run.ts` — the pure module holds the decisions, the `-run` module
 * issues the SQL. Two things follow from it, and both matter here.
 *
 * The first is that {@link compareCoverage} IS THE DROP GATE. It is the function
 * that decides whether an instance's only copy of two months of history may be
 * deleted, and it is a pure function over described rows precisely so that
 * `./backfill.test.ts` can drive every way it should refuse — a missing bucket, a
 * doubled one, a drifted mean, a bucket with an impossible spread, and no rows at
 * all — without a Postgres anywhere.
 *
 * The second is {@link refreshWindows}. A refresh POLICY only covers its recent
 * `start_offset` and will never reach replayed history, and an UNBOUNDED manual
 * refresh advances the watermark past everything, which makes a real-time
 * aggregation test unable to fail. The windows therefore have to be right, and
 * "right" is arithmetic: contiguous, padded by a bucket on each side, chunked so a
 * kill loses one chunk rather than the run.
 */
import type { ChunkResult } from "./replay-run";
import type { UpgradeLogger } from "./upgrade-120-run";
import type { Span } from "./replay";

/**
 * The order the new tiers are materialized in.
 *
 * `hourly` before `daily` is load-bearing: `daily_rollups` is a HIERARCHICAL
 * aggregate over `hourly_rollups`, so a daily bucket built before its hours are
 * finished keeps whatever partial hours existed at the time, and no later refresh
 * of hourly ever revisits it. `minute` is independent (it reads raw) and goes
 * last because it is by far the biggest and a kill during it costs the least.
 */
/**
 * The watermark key one legacy source id replays under.
 *
 * A 1.x database can hold MORE THAN ONE `inverter_id`, because that column held
 * the PROFILE id and a profile swap silently started a new series — the bug this
 * release exists to end. Production is such a database: it carries
 * `deye-sg05lp3` for the first 3 h 48 m and `deye-sun15k-sg05lp3` for everything
 * after the swap on 2026-07-13. Both belong to the same physical machine and both
 * must land on the same `device_id`.
 *
 * They therefore replay as separate passes, and each needs its OWN watermark: the
 * two spans meet inside one day-chunk, and `replay_progress` is keyed by
 * `(source, device_id, chunk_start)`, so a shared key would make the second pass
 * treat that day as already done and drop its history — the quietest possible
 * data loss, in the middle of the migration whose whole point is to stop exactly
 * that.
 *
 * The PRIMARY id keeps the bare key so a run already part-way through resumes
 * against the rows it has already written, rather than starting over under a new
 * name.
 */
export function replayWatermarkSource(base: string, sourceId: string, primary: string): string {
  return sourceId === primary ? base : `${base}#${sourceId}`;
}

export const REFRESH_ORDER = ["hourly_rollups", "daily_rollups", "minute_rollups"] as const;

export type NewTier = (typeof REFRESH_ORDER)[number];

/** Bucket width per tier, in ms — the padding a refresh window needs. */
const TIER_BUCKET_MS: Record<NewTier, number> = {
  minute_rollups: 60_000,
  hourly_rollups: 3_600_000,
  daily_rollups: 86_400_000,
};

const DAY_MS = 86_400_000;

/**
 * The bounded windows one tier is refreshed over, oldest first.
 *
 * PADDED by one bucket on each side, because `refresh_continuous_aggregate`
 * refreshes the buckets fully inside its window: a span that starts mid-bucket
 * would leave that bucket unmaterialized, and it is the oldest one — the exact
 * bucket an operator checks to see whether the migration worked.
 *
 * CHUNKED so a kill costs one chunk rather than the run. Contiguous by
 * construction: a gap between two windows would be a band of buckets no refresh
 * ever covers and nothing would report it.
 *
 * An empty or reversed span yields NO windows. That matters more than it looks:
 * the failure to avoid is turning "nothing to do" into
 * `refresh_continuous_aggregate(x, NULL, NULL)`, which advances the watermark
 * past everything.
 */
export function refreshWindows(span: Span, tier: NewTier, chunkDays = 7): Span[] {
  if (span.end.getTime() <= span.start.getTime()) return [];
  const pad = TIER_BUCKET_MS[tier];
  // ALIGNED TO BUCKET BOUNDARIES, and this is not tidiness.
  //
  // `refresh_continuous_aggregate` materializes only the buckets a window FULLY
  // CONTAINS. An unaligned window therefore leaves the bucket straddling each
  // seam refreshed by neither the window before it nor the one after — and
  // nothing reports it, because every raw row is present and only the aggregate
  // is short.
  //
  // Production hit exactly that. Its replayed span begins at 21:00, so 7-day
  // windows ran 07-11 21:00 -> 07-18 21:00 -> 07-25 21:00 …, and the daily
  // buckets starting 07-18, 07-25, 08-01 and 08-08 fell between two windows.
  // Four whole days were missing from `daily_rollups` while their raw rows sat
  // there untouched. The span had previously started at midnight, which is the
  // only reason this had never shown up.
  //
  // Flooring the start and ceiling the end also keeps the padding honest: every
  // bucket overlapping the span still lands strictly inside some window.
  const from = Math.floor((span.start.getTime() - pad) / pad) * pad;
  const to = Math.ceil((span.end.getTime() + pad) / pad) * pad;
  const step = Math.max(1, chunkDays) * DAY_MS;
  const windows: Span[] = [];
  for (let cursor = from; cursor < to; cursor += step) {
    windows.push({ start: new Date(cursor), end: new Date(Math.min(cursor + step, to)) });
  }
  // THE TRAILING REMAINDER IS MERGED, NOT LEFT ALONE.
  //
  // `refresh_continuous_aggregate` REFUSES a window narrower than one bucket
  // ("The refresh window must cover at least one bucket of data"), and whether
  // the last window is narrower is pure arithmetic on the span: it happens
  // whenever `(span + 2 * pad) mod step` lands under one bucket. The synthetic
  // fixture's span divided evenly and never produced one; the real 1.2.0
  // database did — 2026-07-12T00:00Z -> 2026-08-14T19:37:42Z leaves a 19h37m
  // daily remainder, which aborted the upgrade after eight minutes with the data
  // already carried and replayed.
  //
  // Merged into its predecessor rather than dropped: the remainder is the most
  // RECENT band of buckets, so dropping it would leave the newest day
  // unmaterialized — the tail a user looks at first. Merging keeps the windows
  // contiguous and keeps every one of them at least a bucket wide, which is the
  // only property the engine actually demands.
  const last = windows.at(-1);
  const previous = windows.at(-2);
  if (last && previous && last.end.getTime() - last.start.getTime() < pad) {
    windows[windows.length - 2] = { start: previous.start, end: last.end };
    windows.pop();
  }
  return windows;
}

/**
 * The `call refresh_continuous_aggregate(...)` for one window.
 *
 * The tier is INTERPOLATED (a relation name cannot be a bound parameter) and is
 * therefore checked against {@link REFRESH_ORDER} first — the same defence
 * `./replay.ts`'s `assertIdentifier` applies for the same reason. The bounds are
 * bound.
 */
export function refreshCall(tier: NewTier, window: Span): { text: string; params: string[] } {
  if (!REFRESH_ORDER.includes(tier)) {
    throw new Error(`backfill: ${JSON.stringify(tier)} is not one of this schema's tiers`);
  }
  return {
    text: `call refresh_continuous_aggregate('${tier}', $1::timestamptz, $2::timestamptz)`,
    params: [window.start.toISOString(), window.end.toISOString()],
  };
}

/** One (metric, day) as the legacy minute tier and the new one see it. */
export interface CoverageRow {
  metric: string;
  day: string;
  legacyBuckets: number;
  newBuckets: number;
  legacyMean: number | null;
  /**
   * The new tier's value for the same buckets, read as `max_value`.
   *
   * NOT `average(tw)`, and the reason is measured rather than stylistic:
   * `average(tw)` over a bucket holding ONE sample is NULL — a point has no
   * duration — and a replayed bucket holds exactly one interval row by
   * construction, so every value would come back null and the whole gate would
   * report "the mean disappeared" on a perfectly correct migration. A replayed
   * bucket's `max_value` IS the legacy mean (`./replay.ts`: the interval carries
   * `avg_value` flat across the bucket, so max = min = mean), which makes this
   * both exact and one index scan rather than a window function over 5.7 M rows.
   * The time-weighted READ path is proved to reproduce the same number by
   * `scripts/upgrade-rehearsal.ts`, on a sample, where the cost does not matter.
   */
  newMean: number | null;
  /**
   * `max(max_value - min_value)` across the day, on the new tier.
   *
   * Must be zero over the replayed span. It is what distinguishes "one flat
   * interval row landed in this bucket" from "two rows landed in it" in a way the
   * bucket COUNT cannot see — a double write inside one minute produces one
   * bucket, not two.
   */
  newSpread: number | null;
}

/** Relative tolerance on a mean: float noise, not a smoothed value. */
const MEAN_EPSILON = 1e-9;

/**
 * Everything the replay did not carry, or carried twice.
 *
 * THIS IS THE GATE that lets an instance's only copy of two months of history be
 * dropped, so it asks the two questions that can actually go wrong and nothing
 * softer:
 *
 *  * BUCKET COUNT, exactly. The replay writes one interval row per legacy bucket
 *    and the new minute tier makes one bucket of each, so the counts are equal or
 *    something is wrong. FEWER means history was lost. MORE means a double write,
 *    which `./replay.ts` calls the one error a replay must never make — and which
 *    would otherwise look like more data.
 *  * THE MEAN. Replay's whole claim is that a bucket's mean survives to the bit
 *    (`time_weight('LOCF', …)` over a flat interval reproduces it). If it drifts,
 *    the values were re-based, smoothed or read from the wrong column.
 *
 * NO ROWS AT ALL is a finding rather than a pass. A comparison over nothing
 * proves nothing, and this is the one place where the consequence of a vacuous
 * green is permanent.
 */
/**
 * What is wrong with ONE metric-day, or `null`.
 *
 * The checks are ordered cheapest-and-most-decisive first and each one RETURNS: a
 * metric-day with no new buckets has no meaningful mean to compare, and reporting
 * both would bury the finding that matters under a derived one.
 */
function coverageRowProblem(row: CoverageRow): string | null {
  const label = `${row.metric} ${row.day}`;
  if (row.newBuckets === 0) {
    return `${label}: ${row.legacyBuckets} legacy buckets, no new buckets at all`;
  }
  if (row.newBuckets !== row.legacyBuckets) {
    return (
      `${label}: ${row.legacyBuckets} legacy buckets, ${row.newBuckets} after — ` +
      (row.newBuckets > row.legacyBuckets ? "a double write" : "history was lost")
    );
  }
  return meanProblem(row, label) ?? spreadProblem(row, label);
}

/**
 * Whether the bucket's MEAN survived, which is replay's whole claim.
 *
 * `time_weight('LOCF', …)` over a flat interval row reproduces the bucket's mean
 * to the bit, so a drift means the values were re-based, smoothed, or read from
 * the wrong column.
 */
function meanProblem(row: CoverageRow, label: string): string | null {
  const before = row.legacyMean;
  const after = row.newMean;
  if (before === null || after === null) {
    // One null and one number is a real disagreement; both null is a metric that
    // legitimately has no mean on that day.
    return before === after ? null : `${label}: mean ${before} legacy, ${after} after`;
  }
  return Math.abs(before - after) > MEAN_EPSILON * Math.max(1, Math.abs(before))
    ? `${label}: mean ${before} legacy, ${after} after — the values are not the same`
    : null;
}

/**
 * A double write the BUCKET COUNT cannot see.
 *
 * The replay writes exactly one row per bucket, so a replayed bucket's min and
 * max are the same number. Any spread means a second row landed in it — and the
 * count stays right, because both rows are still one bucket.
 */
function spreadProblem(row: CoverageRow, label: string): string | null {
  if (typeof row.newSpread !== "number" || row.newSpread === 0) return null;
  return (
    `${label}: a replayed bucket spans ${row.newSpread} between its min and max, so more than ` +
    `one row landed in it — a double write the bucket count cannot see`
  );
}

export function compareCoverage(rows: readonly CoverageRow[]): string[] {
  if (rows.length === 0) {
    return [
      "verification compared 0 metric-days: there is nothing to compare, which proves nothing. " +
        "The legacy objects must NOT be dropped.",
    ];
  }
  return rows
    .map((row) => coverageRowProblem(row))
    .filter((problem): problem is string => problem !== null);
}

/** What the backfill needs that it cannot read for itself. */
export interface BackfillInput {
  /** The device every legacy reading now belongs to. Supplied per install. */
  deviceId: number;
  /** Metric keys the profile stores as configuration. Never a prefix match. */
  configKeys?: readonly string[];
  /** The measured poll cadence for the carried raw window. */
  rawDurMs: number | null;
  /** Which legacy tiers still hold buckets. Defaults to all three. */
  tiers?: Partial<Record<"minute" | "hourly" | "daily", string>>;
  logger?: UpgradeLogger;
  /** Refresh chunk size. Smaller loses less to a kill; larger is faster. */
  refreshChunkDays?: number;
}

/** The watermark namespace the bucket replay records its days under. */
export const BUCKET_REPLAY_SOURCE = "legacy-1.2.0-buckets";

/** The watermark namespace the aggregate refresh records its windows under. */
export const REFRESH_SOURCE = "legacy-1.2.0-refresh";

/**
 * Configuration registers that reached the hypertable, or nothing.
 *
 * The other half of excluding them from the coverage comparison. 1.2.0 wrote
 * configuration registers into `metrics_raw`, so they are in the minute buckets
 * too, and the replay routes them to `metrics_config_log` as CHANGES ONLY —
 * which collapses a whole settings history to a couple of hundred rows and is
 * what issue #150 asks for. If any landed in the hypertable instead, the
 * coverage comparison would not see it (it stopped looking) and the storage
 * budget this release exists to fix would be quietly back.
 */
export function configLeak(rowsInRaw: number): string[] {
  if (rowsInRaw === 0) return [];
  return [
    `${rowsInRaw} configuration-register row(s) reached metrics_raw — they belong in ` +
      `metrics_config_log (#150)`,
  ];
}

/** Progress line for one replayed chunk, for a CLI. */
export function chunkLine(chunk: ChunkResult, index: number, total: number): string {
  const rate = chunk.elapsedMs > 0 ? Math.round((chunk.seriesRows / chunk.elapsedMs) * 1000) : 0;
  return (
    `[${index + 1}/${total}] ${chunk.start.toISOString().slice(0, 10)} ${chunk.tier}: ` +
    `${chunk.seriesRows.toLocaleString("en-US")} rows + ${chunk.configRows} config in ` +
    `${(chunk.elapsedMs / 1000).toFixed(1)}s (${rate.toLocaleString("en-US")} rows/s)`
  );
}
