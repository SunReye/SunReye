/**
 * BUCKET REPLAY, the arithmetic half: turning materialized aggregate buckets
 * back into `metrics_raw` interval rows.
 *
 * ## Why this exists at all
 *
 * The one production instance runs addon 1.2.0 and holds ~2 months of history.
 * 1.2.0's raw retention is SEVEN DAYS, so everything older exists only as
 * materialized continuous-aggregate buckets (`minute_rollups` at 90 days,
 * `hourly_rollups` at 730, `daily_rollups` forever). 2.0.0 changes
 * `metrics_raw`'s columns, and a continuous aggregate's definition cannot be
 * altered while its materialization hypertable cannot be inserted into — so a
 * new aggregate over the new `metrics_raw` can only materialize as far back as
 * raw reaches, i.e. one week. Two months of history would silently become one.
 *
 * The way out is to replay the old buckets FORWARD as raw rows: one
 * `metrics_raw` row per historical bucket, stamped at BUCKET START, with
 * `dur_ms` = the bucket width. The new aggregates then materialize over them
 * exactly as they would over a live poll, and every read path — including
 * `counter_agg`/`delta`, which is the whole reason the reset arithmetic is
 * finally right — sees a series it understands.
 *
 * ## What replay preserves and what it destroys
 *
 * PRESERVED, exactly: the bucket's MEAN. A replayed interval row carries the
 * bucket's `avg_value` for the bucket's whole width, so
 * `time_weight('LOCF', …)` over the replayed rows reproduces that mean to the
 * bit.
 *
 * DESTROYED, knowingly: per-bucket MIN and MAX for the pre-cutover span. A
 * bucket that held a min of 0 and a max of 4000 replays as one flat value, and
 * the new tier's `max_value`/`min_value` for that span are therefore both equal
 * to the mean. This is accepted — a bucket cannot be un-averaged — and it is
 * pinned by a test rather than left in prose, so nobody later mistakes replay
 * for lossless (`apps/server/db-tests/replay.test.ts`).
 *
 * ## Why the unweighted 1.2.0 mean is the right number to carry
 *
 * 1.2.0's aggregates hold `avg(value)`, unweighted. For 1.2.0 DATA that is the
 * time-weighted mean: the writer stored EVERY sample at a fixed cadence
 * (change-encoding arrived after 1.2.0, in #117), so every row stood for an
 * equal slice of time and the two means coincide. Verified against the real
 * schema — `git show addon-v1.2.0:packages/db/src/timescale/0000_bootstrap.sql`
 * defines all three tiers as `avg/max/min` over `metrics_raw` and 1.2.0 has no
 * second, weighted generation. So `avg_value` is read directly and there is no
 * arm-preference logic to get wrong.
 *
 * ## Why this file is pure
 *
 * The volume forces the row work into SQL: two months of minute buckets for one
 * device with ~108 metrics is ~9.3 M rows, which cannot be a round trip per row.
 * So `./replay-run.ts` composes `INSERT … SELECT` over the dimension joins, and
 * everything that is a DECISION — the bucket width, the timestamp, the value
 * selection, which tier answers which day, which chunks are still pending —
 * lives here, where it is unit-tested without a database.
 */

/** The three tiers 1.2.0 materialized, finest first. Order is load-bearing. */
const TIERS = ["minute", "hourly", "daily"] as const;

export type BucketTier = (typeof TIERS)[number];

/**
 * The width of one bucket of each tier, in milliseconds — and therefore the
 * `dur_ms` a replayed row carries.
 *
 * Fixed rather than read from `time_bucket`'s argument because these are the
 * widths 1.2.0's aggregate definitions actually use, and a mismatch between the
 * declared width and the stored buckets would misstate every hold rather than
 * fail. A calendar-aware width (a month, a DST-affected day) is deliberately
 * absent: no tier here has one, and `time_bucket('1 day', …)` on a `timestamptz`
 * is a fixed 24 h from the UTC epoch, which is what makes a constant correct.
 */
const TIER_WIDTH_MS: Record<BucketTier, number> = {
  minute: 60_000,
  hourly: 3_600_000,
  daily: 86_400_000,
};

/** The `dur_ms` a replayed row of `tier` carries. */
export function bucketWidthMs(tier: BucketTier): number {
  return TIER_WIDTH_MS[tier];
}

/**
 * One materialized 1.2.0 bucket, as far as replay cares: when it starts and what
 * its mean was. `Date | string` because a bucket read back through a driver
 * arrives as either.
 */
export interface LegacyBucket {
  bucket: Date | string;
  /** 1.2.0's `avg_value`. `null` when the bucket materialized no mean. */
  avgValue: number | null;
}

/** One `metrics_raw` interval row, before identity is attached. */
export interface IntervalRow {
  /** The bucket's START — an interval begins when it begins. */
  time: Date;
  value: number;
  /** The bucket width: how long this value is claimed to have been held. */
  durMs: number;
}

/**
 * The one bucket -> one interval row mapping, or `null` for a bucket that
 * carries no reading.
 *
 * A `null` mean is dropped rather than replayed as 0: 1.2.0 materialized a row
 * only for a (bucket, inverter, metric) that had samples, but a defensive drop
 * costs nothing and a zero would be a fabricated reading. A mean of ZERO, by
 * contrast, is kept — a PV string at night and a battery at rest both measure
 * zero, and conflating "measured zero" with "no data" is the exact confusion the
 * decode layer refuses one level down. Negative means are kept for the same
 * reason: export power and battery discharge are signed.
 */
export function bucketToInterval(tier: BucketTier, row: LegacyBucket): IntervalRow | null {
  if (row.avgValue === null || row.avgValue === undefined) return null;
  return { time: bucketStart(row.bucket), value: row.avgValue, durMs: bucketWidthMs(tier) };
}

/**
 * Parse a bucket timestamp, refusing what it cannot read.
 *
 * A silent `Invalid Date` would reach the insert as `NULL` on a `NOT NULL`
 * column at best, and as a row stamped at the epoch at worst — on a migration
 * that gets one attempt.
 */
function bucketStart(bucket: Date | string): Date {
  const time = bucket instanceof Date ? bucket : new Date(bucket);
  if (Number.isNaN(time.getTime())) {
    throw new Error(`replay: cannot parse bucket timestamp ${JSON.stringify(bucket)}`);
  }
  return time;
}

/** A half-open time span, `[start, end)`. */
export interface Span {
  start: Date;
  end: Date;
}

/** The window a tier still holds buckets for — i.e. what retention left. */
export interface TierWindow {
  tier: BucketTier;
  /** Earliest bucket the tier holds. */
  from: Date;
  /** Exclusive end of the tier's coverage. */
  to: Date;
}

/**
 * The finest tier whose materialized window covers the WHOLE span, or `null`.
 *
 * "Finest" matters: at 1.2.0's retention the 90-day minute tier covers the whole
 * two-month history, so replaying from `hourly` would throw away 60x the
 * resolution for no reason. "Whole span" matters too — a tier covering half a
 * chunk would leave the other half unwritten, which is worse than using a
 * coarser tier for all of it.
 */
function finestTierCovering(windows: readonly TierWindow[], span: Span): BucketTier | null {
  for (const tier of TIERS) {
    const window = windows.find((w) => w.tier === tier);
    if (!window) continue;
    if (
      window.from.getTime() <= span.start.getTime() &&
      window.to.getTime() >= span.end.getTime()
    ) {
      return tier;
    }
  }
  return null;
}


/**
 * At the OUTER EDGES of the replay span only: the finest tier that overlaps the
 * chunk, and the chunk narrowed to what that tier actually holds.
 *
 * {@link finestTierCovering} demands whole-chunk coverage, and for a chunk in the
 * MIDDLE of the span that is right — the minute tier's retention boundary leaves
 * it covering a morning while `daily` covers the day, and clipping there would
 * throw the afternoon away. At the first and last chunk the situation is the
 * opposite: the uncovered part is not a hole in the middle of the history, it is
 * before the history starts (or after it ends), so there is nothing there to lose.
 *
 * Production made the difference concrete. Its history begins at 21:38 on
 * 2026-07-12, so the minute tier starts mid-day and the whole-chunk rule fell
 * back to `daily` — one bucket for the day. A single replayed row cannot express
 * a within-day counter delta, so every counter read 0 for the first day of
 * history while 142 real minute buckets per metric sat unused.
 *
 * `isFirst` may only extend the start forward and `isLast` may only pull the end
 * back, which is what keeps this from becoming the mid-span clip the whole-chunk
 * rule exists to prevent. The remainder is returned to the caller as a GAP rather
 * than dropped, so a genuine hole is still reported.
 */
function clipToTierAtEdge(
  windows: readonly TierWindow[],
  span: Span,
  edge: { isFirst: boolean; isLast: boolean },
): { tier: BucketTier; span: Span } | null {
  for (const tier of TIERS) {
    const window = windows.find((w) => w.tier === tier);
    if (window && usableAtEdge(window, span, edge)) {
      return {
        tier,
        span: {
          start: new Date(Math.max(window.from.getTime(), span.start.getTime())),
          end: new Date(Math.min(window.to.getTime(), span.end.getTime())),
        },
      };
    }
  }
  return null;
}

/**
 * Whether one tier's window can answer this edge chunk.
 *
 * Whole coverage still wins outright when the finest tier has it. The two edge
 * cases are what let a FINER tier beat a coarser one that covers the chunk
 * completely: at 2026-07-12 the daily tier covered the whole day while the minute
 * tier covered only its last two hours, and the minute tier is the one holding
 * the day's real readings.
 */
function usableAtEdge(
  window: TierWindow,
  span: Span,
  edge: { isFirst: boolean; isLast: boolean },
): boolean {
  const overlaps =
    Math.max(window.from.getTime(), span.start.getTime()) <
    Math.min(window.to.getTime(), span.end.getTime());
  if (!overlaps) return false;
  const reachesEnd = window.to.getTime() >= span.end.getTime();
  const reachesStart = window.from.getTime() <= span.start.getTime();
  return (reachesStart && reachesEnd) || (edge.isFirst && reachesEnd) || (edge.isLast && reachesStart);
}

/**
 * Narrow a requested span to what the source's tiers actually hold.
 *
 * A caller's `to` is the migration record's `replayTo` — the point where the
 * retained raw window takes over — and it is the same for every source id. But a
 * 1.x database can hold SEVERAL ids (a profile swap started a new series under a
 * new name), and an orphaned one may cover only hours. Without this, every day
 * beyond that id's history is planned, matches no tier, and is reported as a gap:
 * 28 lines saying "no tier could answer" about days the source never had, in the
 * middle of a migration where a real gap is the thing an operator must not miss.
 *
 * Only the OUTER bounds move. A genuine hole inside the coverage still produces a
 * gap, which is the whole point of reporting them.
 */
export function clampToCoverage(
  requested: { from: Date; to: Date },
  coverage: { from: Date; to: Date },
): { from: Date; to: Date } {
  return {
    from: new Date(Math.max(requested.from.getTime(), coverage.from.getTime())),
    to: new Date(Math.min(requested.to.getTime(), coverage.to.getTime())),
  };
}

/** One unit of replay work: a span, and the tier that answers it. */
export interface ReplayChunk extends Span {
  tier: BucketTier;
}

export interface ReplayPlanInput {
  /** Start of the span to replay, inclusive. */
  from: Date;
  /** End of the span to replay, exclusive. */
  to: Date;
  /** What each tier still holds. A tier with no window is simply not used. */
  windows: readonly TierWindow[];
}

export interface ReplayPlan {
  /** The work, in ascending time order. */
  chunks: ReplayChunk[];
  /** Days no tier could answer. Reported, never skipped silently. */
  gaps: Span[];
}

/** Milliseconds in a UTC day. `time_bucket('1 day')` uses exactly this. */
const DAY_MS = 86_400_000;

/**
 * Split the span into one chunk per UTC day and pick a tier for each.
 *
 * ONE DAY per chunk, and both the size and the alignment earn their keep:
 *
 *  * it bounds the transaction — a day of minute buckets is ~155 k rows for one
 *    device at ~108 metrics, which commits in well under a second, so a kill
 *    loses at most that;
 *  * it aligns with `metrics_raw`'s 1-day `chunk_time_interval`, so one replay
 *    transaction writes into one hypertable chunk instead of straddling two;
 *  * it is the granularity the watermark records, so "resume" is exact rather
 *    than approximate.
 *
 * The first and last chunk keep the caller's own bounds rather than being rounded
 * out to whole days: the upgrade replays "everything older than the raw window",
 * and that boundary is wherever the retained raw actually begins. Rounding
 * outwards would double-write the overlap.
 *
 * A tier is chosen PER CHUNK, and a chunk is never split between tiers. Mixing
 * widths inside one chunk would put an hourly interval and the minute intervals
 * inside it on the same series, which is a double count — the one error a replay
 * must never make.
 */
/**
 * One day-chunk's outcome: the work it produced, and the spans it could not
 * answer.
 *
 * Split out of {@link planReplay} so the loop stays a loop and the DECISION stays
 * a decision. Both were one function until the edge-clipping arrived and pushed
 * it past the repo's complexity ceiling — which was a fair reading, because the
 * cursor arithmetic and the tier choice have nothing to do with each other.
 */
function planOneChunk(
  windows: readonly TierWindow[],
  span: Span,
  edge: { isFirst: boolean; isLast: boolean },
): { chunk: ReplayChunk | null; gaps: Span[] } {
  const atEdge = edge.isFirst || edge.isLast;
  if (!atEdge) {
    const tier = finestTierCovering(windows, span);
    return tier === null ? { chunk: null, gaps: [span] } : { chunk: { tier, ...span }, gaps: [] };
  }
  const clipped = clipToTierAtEdge(windows, span, edge);
  if (clipped === null) return { chunk: null, gaps: [span] };

  // The uncovered remainder is REPORTED, never silently dropped — the whole point
  // of `gaps` is that a day no tier could answer stays visible.
  const gaps: Span[] = [];
  if (clipped.span.start.getTime() > span.start.getTime()) {
    gaps.push({ start: span.start, end: clipped.span.start });
  }
  if (clipped.span.end.getTime() < span.end.getTime()) {
    gaps.push({ start: clipped.span.end, end: span.end });
  }
  return { chunk: { tier: clipped.tier, ...clipped.span }, gaps };
}

export function planReplay(input: ReplayPlanInput): ReplayPlan {
  const chunks: ReplayChunk[] = [];
  const gaps: Span[] = [];
  const end = input.to.getTime();
  let cursor = input.from.getTime();
  while (cursor < end) {
    const dayEnd = Math.floor(cursor / DAY_MS) * DAY_MS + DAY_MS;
    const span: Span = { start: new Date(cursor), end: new Date(Math.min(dayEnd, end)) };
    const planned = planOneChunk(input.windows, span, {
      isFirst: cursor === input.from.getTime(),
      isLast: dayEnd >= end,
    });
    if (planned.chunk !== null) chunks.push(planned.chunk);
    gaps.push(...planned.gaps);
    cursor = dayEnd;
  }
  return { chunks, gaps };
}

/**
 * The watermark key of a chunk: its start, as an ISO instant.
 *
 * Deliberately NOT including the tier. A chunk that was replayed from `hourly`
 * because minute coverage had aged out must not be replayed a second time
 * because a later run found the minute tier — the span is written, and which
 * tier wrote it is a detail of the run, recorded beside the watermark rather
 * than inside its identity.
 */
function chunkKey(chunk: Span): string {
  return chunk.start.toISOString();
}

/**
 * The chunks a resumed run still has to do, in order.
 *
 * This is the whole of resumability's read side: the watermark table holds one
 * row per COMPLETED chunk (written in the same transaction as the rows it
 * describes), so a killed process resumes at the first chunk with no row and a
 * finished run replays nothing at all.
 */
export function pendingChunks(
  chunks: readonly ReplayChunk[],
  done: ReadonlySet<string>,
): ReplayChunk[] {
  return chunks.filter((chunk) => !done.has(chunkKey(chunk)));
}

/**
 * A bare lower-case SQL identifier, or a refusal.
 *
 * The replay reads from a relation whose NAME is decided by the caller — the
 * in-place upgrade renames 1.2.0's aggregates out of the way, an import
 * populates a staging table — and a relation name cannot be a bound parameter.
 * So it is interpolated, and the only defence is to refuse to interpolate
 * anything that is not an identifier. The pattern is deliberately narrower than
 * Postgres allows (no quoting, no schema qualification, no upper case, 63 bytes
 * being the real identifier limit): every name this module is ever handed is a
 * relation this repo creates.
 */
export function assertIdentifier(name: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(name) || name.length > 63) {
    throw new Error(`replay: ${JSON.stringify(name)} is not a bare SQL identifier`);
  }
  return name;
}
