/**
 * THE BACKFILL: the long, resumable half of the 1.2.0 -> 2.0.0 upgrade.
 *
 * `./upgrade-120-run.ts`'s blocking step leaves a serving 2.0.0 schema in 0.2 s
 * and the whole pre-cutover history sitting in the inert `legacy_*` relations.
 * This is what brings it across, and it is a SEPARATE STEP for a measured
 * reason: `sunreye/config.yaml` sets `timeout: 120` with a watchdog on
 * `/healthz` and `init-migrate` gates server start, while replaying ~9.1 M minute
 * buckets plus refreshing three tiers over the same span is ~133 s on a dev box —
 * already over the timeout, and a Home Assistant box on eMMC is materially
 * slower.
 *
 * ## The four things it does, in this order
 *
 *  1. CARRY the retained legacy raw window (7 days on 1.2.0, ~1.06 M rows on the
 *     real fixture) — see `carryLegacyRaw`.
 *  2. REPLAY the legacy buckets, bounded to stop where the carried raw begins so
 *     the two cannot double-write the same span.
 *  3. REFRESH the new aggregates over the replayed span, BOUNDED and PARENT
 *     FIRST. Refresh POLICIES only ever cover their recent `start_offset`
 *     (3 hours, 3 days), so nothing in the background will ever materialize a
 *     bucket from two months ago. `refresh_continuous_aggregate(x, NULL, NULL)`
 *     would advance the watermark past everything and make a real-time
 *     aggregation bug unable to fail, so every window here is explicit.
 *  4. VERIFY, and only then let the legacy objects be dropped. Until verification
 *     passes they are not dead weight — they are THE ROLLBACK, and the only thing
 *     between a failed migration and data loss, because there is no intermediate
 *     release and no user-performed export beforehand.
 *
 * ## Resumability is not a feature here, it is the shape
 *
 * Power loss, an addon restart and a Supervisor timeout are the EXPECTED
 * interruptions, not exotic ones. The replay's own watermark
 * (`replay_progress`, written in the same transaction as the rows it describes)
 * covers steps 1 and 2. Step 3 records its windows in the same table under a
 * `source` of its own: a refresh is idempotent, so re-running one is only a cost,
 * but on a 60-day minute tier that cost is most of the run.
 */

import { type ChunkResult, type ReplayOptions, type ReplayResult, runReplay } from "./replay-run";
import type { Span } from "./replay";
import { LEGACY_NAME } from "./upgrade-120";
import {
  type CarryRawInput,
  type UpgradeClient,
  type UpgradeLogger,
  carryLegacyRaw,
  readMigrationRecord,
  writeMigrationRecord,
} from "./upgrade-120-run";
import { type MigrationRecord, mayDropLegacy, migrationRecordSchema } from "./upgrade-state";

/**
 * The order the new tiers are materialized in.
 *
 * `hourly` before `daily` is load-bearing: `daily_rollups` is a HIERARCHICAL
 * aggregate over `hourly_rollups`, so a daily bucket built before its hours are
 * finished keeps whatever partial hours existed at the time, and no later refresh
 * of hourly ever revisits it. `minute` is independent (it reads raw) and goes
 * last because it is by far the biggest and a kill during it costs the least.
 */
// fallow-ignore-next-line unused-export -- the order the tiers must materialize in (daily reads hourly, so never daily first); pinned by ./backfill.test.ts.
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
// fallow-ignore-next-line unused-export -- the bounded refresh windows, proved by ./backfill.test.ts — an unbounded refresh advances the watermark past everything and makes those tests unable to fail.
export function refreshWindows(span: Span, tier: NewTier, chunkDays = 7): Span[] {
  if (span.end.getTime() <= span.start.getTime()) return [];
  const pad = TIER_BUCKET_MS[tier];
  const from = span.start.getTime() - pad;
  const to = span.end.getTime() + pad;
  const step = Math.max(1, chunkDays) * DAY_MS;
  const windows: Span[] = [];
  for (let cursor = from; cursor < to; cursor += step) {
    windows.push({ start: new Date(cursor), end: new Date(Math.min(cursor + step, to)) });
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
// fallow-ignore-next-line unused-export -- the refresh statement itself, pinned by ./backfill.test.ts; runBackfill below is its caller.
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

// fallow-ignore-next-line unused-export -- the drop gate's comparison, proved by ./backfill.test.ts; verifyMigration below is its caller. It decides whether an instance's only copy of two months of history may be deleted, so it is tested directly rather than through the query around it.
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
// fallow-ignore-next-line unused-export -- the replay_progress source key; changing it silently restarts a finished backfill, so it is asserted by apps/server/db-tests/upgrade.test.ts — a directory .fallowrc.json excludes from tracing entirely.
export const BUCKET_REPLAY_SOURCE = "legacy-1.2.0-buckets";

/** The watermark namespace the aggregate refresh records its windows under. */
// fallow-ignore-next-line unused-export -- as above: the refresh arm's progress key, asserted in the database tests, which are not traced.
export const REFRESH_SOURCE = "legacy-1.2.0-refresh";

/** The legacy relations the bucket replay reads, by tier. */
const LEGACY_TIERS = {
  minute: LEGACY_NAME.minute_rollups,
  hourly: LEGACY_NAME.hourly_rollups,
  daily: LEGACY_NAME.daily_rollups,
} as const;

export interface BackfillResult {
  carried: ReplayResult | null;
  replayed: ReplayResult | null;
  refreshed: number;
  record: MigrationRecord;
  elapsedMs: number;
}

const silent: UpgradeLogger = { log: () => {} };

/**
 * Carry the raw window, replay the buckets, refresh the tiers — resuming
 * wherever the last run stopped.
 *
 * Returns `null` when there is no migration to finish, which is what makes it
 * safe to call from a boot hook or a button without either of them having to
 * know the state.
 */
export async function runBackfill(
  client: UpgradeClient,
  input: BackfillInput,
  options: ReplayOptions = {},
): Promise<BackfillResult | null> {
  const began = Date.now();
  const logger = input.logger ?? silent;
  let record = await readMigrationRecord(client);
  if (record.stage === "none" || record.sourceId === null) return null;
  if (["backfilled", "verified", "dropped"].includes(record.stage)) return null;

  // Captured before the first stage transition: `advance` reassigns `record`, and
  // a re-read of `record.sourceId` afterwards is a value the compiler can no
  // longer prove is non-null (and that a corrupted write could genuinely blank).
  const sourceId = record.sourceId;
  const identity: CarryRawInput = {
    sourceId,
    deviceId: input.deviceId,
    configKeys: input.configKeys,
    durMs: input.rawDurMs,
  };

  const carried =
    record.legacyRawFrom === null ? null : await carryLegacyRaw(client, identity, options);
  if (carried) {
    logger.log(carriedLine(carried));
    record = await advance(client, record, "carried");
  }

  const replayed = await runReplay(
    client,
    {
      source: BUCKET_REPLAY_SOURCE,
      relations: input.tiers ?? { ...LEGACY_TIERS },
      identity: { sourceId, deviceId: input.deviceId },
      configKeys: input.configKeys,
      to: record.replayTo === null ? undefined : new Date(record.replayTo),
    },
    options,
  );
  logger.log(replayedLine(replayed));

  const refreshed = await refreshTiers(client, input, logger);
  record = await advance(client, record, "backfilled");
  return { carried, replayed, refreshed, record, elapsedMs: Date.now() - began };
}

/**
 * The carry's one log line. `skipped` is in it deliberately: on a resumed run it
 * is the number that says the carry was not redone.
 */
function carriedLine(carried: ReplayResult): string {
  return (
    `carried ${carried.seriesRows.toLocaleString("en-US")} retained raw rows + ` +
    `${carried.configRows} config changes in ${(carried.elapsedMs / 1000).toFixed(1)}s ` +
    `(${carried.skipped} day(s) already done)`
  );
}

/**
 * The bucket replay's one log line.
 *
 * GAPS are appended only when there are some — a day no legacy tier could answer
 * is the one outcome here that needs a human to look, and a trailing "0 gaps" on
 * every successful run is how that stops being noticed.
 */
function replayedLine(replayed: ReplayResult): string {
  return (
    `replayed ${replayed.seriesRows.toLocaleString("en-US")} bucket rows + ` +
    `${replayed.configRows} config changes across ${replayed.chunks.length} day(s) in ` +
    `${(replayed.elapsedMs / 1000).toFixed(1)}s (${replayed.skipped} already done)` +
    (replayed.gaps.length > 0 ? ` — ${replayed.gaps.length} day(s) no tier could answer` : "")
  );
}

/** Persist a stage transition and hand back the record that was written. */
async function advance(
  client: UpgradeClient,
  record: MigrationRecord,
  stage: MigrationRecord["stage"],
): Promise<MigrationRecord> {
  const next = migrationRecordSchema.parse({ ...record, stage });
  await writeMigrationRecord(client, next);
  return next;
}

/**
 * The span the new aggregates have to be materialized over: everything the new
 * `metrics_raw` now holds that a refresh policy will never reach.
 *
 * Read from the table rather than from the migration record, because the record
 * describes what the LEGACY side held and this has to cover what actually landed
 * — including the carried raw window, and including a resumed run that wrote part
 * of it on an earlier attempt.
 */
async function writtenSpan(client: UpgradeClient, deviceId: number): Promise<Span | null> {
  const result = await client.query(
    `select min(time) as "from", max(time) as "to" from metrics_raw where device_id = $1`,
    [deviceId],
  );
  const row = (result.rows as { from: Date | string | null; to: Date | string | null }[])[0];
  if (!row?.from || !row?.to) return null;
  return { start: new Date(row.from), end: new Date(row.to) };
}

/** Materialize every tier over the written span, parent first, resumably. */
async function refreshTiers(
  client: UpgradeClient,
  input: BackfillInput,
  logger: UpgradeLogger,
): Promise<number> {
  const span = await writtenSpan(client, input.deviceId);
  if (span === null) return 0;
  let done = 0;
  for (const tier of REFRESH_ORDER) {
    const windows = refreshWindows(span, tier, input.refreshChunkDays ?? 7);
    const began = Date.now();
    for (const window of windows) {
      if (await refreshAlreadyDone(client, tier, input.deviceId, window)) continue;
      const call = refreshCall(tier, window);
      await client.query(call.text, call.params);
      await recordRefresh(client, tier, input.deviceId, window);
      done += 1;
    }
    logger.log(
      `materialized ${tier} over ${windows.length} window(s) in ` +
        `${((Date.now() - began) / 1000).toFixed(1)}s`,
    );
  }
  return done;
}

/**
 * Refresh progress rides in `replay_progress`.
 *
 * It is the same kind of fact the table already holds — "this window of migration
 * work is complete for this device" — keyed on `(source, device_id,
 * chunk_start)`, with a `source` of its own per tier so no two steps can mark
 * each other's windows done. A table of its own would mean another journaled
 * migration for a row shape that already exists, and the alternative (no record
 * at all) means a killed run re-materializes a 60-day minute tier from scratch,
 * which is most of the wall clock.
 */
const refreshSource = (tier: NewTier): string => `${REFRESH_SOURCE}-${tier}`;

async function refreshAlreadyDone(
  client: UpgradeClient,
  tier: NewTier,
  deviceId: number,
  window: Span,
): Promise<boolean> {
  const result = await client.query(
    `select 1 from replay_progress
      where source = $1 and device_id = $2 and chunk_start = $3::timestamptz`,
    [refreshSource(tier), deviceId, window.start.toISOString()],
  );
  return result.rows.length > 0;
}

async function recordRefresh(
  client: UpgradeClient,
  tier: NewTier,
  deviceId: number,
  window: Span,
): Promise<void> {
  await client.query(
    `insert into replay_progress
       (source, device_id, chunk_start, chunk_end, tier, series_rows, config_rows, elapsed_ms)
     values ($1, $2, $3, $4, $5, 0, 0, 0)
     on conflict (source, device_id, chunk_start) do nothing`,
    [refreshSource(tier), deviceId, window.start.toISOString(), window.end.toISOString(), tier],
  );
}

/**
 * Compare the legacy minute tier with the new one, bucket for bucket and mean for
 * mean, over the replayed span — and record `verified` when they agree.
 *
 * The comparison is against THIS DATABASE's legacy objects rather than against a
 * committed ground-truth file, because a production instance has no such file:
 * the question that decides whether the rollback may be deleted is "is everything
 * that was in the old objects now in the new ones", and only the old objects can
 * answer it. (`scripts/upgrade-rehearsal.ts` asks the other question, against the
 * fixture's committed ground truth, with the fixture's own differs.)
 *
 * The span is bounded by `replayTo`: the carried raw window is NOT one legacy
 * bucket per new bucket (it is one poll sample per new sample), so including it
 * would compare two things that are not the same shape.
 */
export async function verifyMigration(
  client: UpgradeClient,
  deviceId: number,
  configKeys: readonly string[] = [],
  logger: UpgradeLogger = silent,
): Promise<{ problems: string[]; compared: number; record: MigrationRecord }> {
  const record = await readMigrationRecord(client);
  if (record.sourceId === null || record.replayTo === null) {
    return {
      problems: ["there is no recorded 1.2.0 migration to verify"],
      compared: 0,
      record,
    };
  }
  const rows = await readCoverage(
    client,
    record.sourceId,
    deviceId,
    new Date(record.replayTo),
    configKeys,
  );
  const problems = [
    ...compareCoverage(rows),
    ...configLeak(await countConfigInRaw(client, deviceId, configKeys)),
  ];
  logger.log(
    problems.length === 0
      ? `verified ${rows.length.toLocaleString("en-US")} metric-days: every legacy bucket has a ` +
          `new bucket with the same mean`
      : `verification found ${problems.length} problem(s) — the legacy objects stay`,
  );
  if (problems.length > 0) return { problems, compared: rows.length, record };
  return { problems, compared: rows.length, record: await advance(client, record, "verified") };
}

/**
 * Per-metric, per-UTC-day bucket counts and means, legacy beside new.
 *
 * A FULL OUTER JOIN, not an inner one: an inner join cannot see a day that is
 * only on one side, which is the finding that matters most. The day key is
 * `date_trunc('day', …)` in UTC on both sides so the two are keyed identically —
 * the plant's display zone is a render concern and would make the two halves
 * disagree about which day a bucket belongs to.
 */
async function readCoverage(
  client: UpgradeClient,
  sourceId: string,
  deviceId: number,
  replayTo: Date,
  configKeys: readonly string[],
): Promise<CoverageRow[]> {
  // CONFIGURATION registers are excluded from the legacy side because they were
  // never meant to reach the hypertable: at 1.2.0 they were written to
  // `metrics_raw` (and so are in the minute buckets), and the replay routes them
  // to `metrics_config_log` as CHANGES instead (#150). Comparing them here would
  // report every one of them as lost history on a migration that handled them
  // exactly right — 39 of this profile's 105 metrics. That they did NOT leak into
  // the hypertable is asserted separately, by {@link configLeak}, because an
  // exclusion is not a check.
  const exclude =
    configKeys.length === 0
      ? ""
      : `and b.metric not in (${configKeys.map((_, i) => `$${i + 4}`).join(", ")})`;
  const result = await client.query(
    `with legacy as (
       select b.metric as metric, date_trunc('day', b.bucket) as day,
              count(*)::bigint as buckets, avg(b.avg_value) as mean
       from ${LEGACY_NAME.minute_rollups} b
       where b.inverter_id = $1 and b.bucket < $3::timestamptz and b.avg_value is not null
         ${exclude}
       group by 1, 2
     ),
     fresh as (
       select mk.key as metric, date_trunc('day', m.bucket) as day,
              count(*)::bigint as buckets, avg(m.max_value) as mean,
              max(m.max_value - m.min_value) as spread
       from minute_rollups m
       join metric_keys mk on mk.id = m.metric_id
       where m.device_id = $2 and m.bucket < $3::timestamptz
       group by 1, 2
     )
     select coalesce(l.metric, f.metric) as metric,
            to_char(coalesce(l.day, f.day), 'YYYY-MM-DD') as day,
            coalesce(l.buckets, 0)::bigint as "legacyBuckets",
            coalesce(f.buckets, 0)::bigint as "newBuckets",
            l.mean as "legacyMean", f.mean as "newMean", f.spread as "newSpread"
     from legacy l full outer join fresh f on f.metric = l.metric and f.day = l.day
     order by 1, 2`,
    [sourceId, deviceId, replayTo.toISOString(), ...configKeys],
  );
  return (result.rows as Record<string, unknown>[]).map((row) => ({
    metric: String(row.metric),
    day: String(row.day),
    // bigint arrives as a STRING through both drivers.
    legacyBuckets: Number(row.legacyBuckets),
    newBuckets: Number(row.newBuckets),
    legacyMean: row.legacyMean === null ? null : Number(row.legacyMean),
    newMean: row.newMean === null ? null : Number(row.newMean),
    newSpread: row.newSpread === null || row.newSpread === undefined ? null : Number(row.newSpread),
  }));
}

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
// fallow-ignore-next-line unused-export -- the config-register leak check, proved by ./backfill.test.ts; verifyMigration below is its caller.
export function configLeak(rowsInRaw: number): string[] {
  if (rowsInRaw === 0) return [];
  return [
    `${rowsInRaw} configuration-register row(s) reached metrics_raw — they belong in ` +
      `metrics_config_log (#150)`,
  ];
}

async function countConfigInRaw(
  client: UpgradeClient,
  deviceId: number,
  configKeys: readonly string[],
): Promise<number> {
  if (configKeys.length === 0) return 0;
  const placeholders = configKeys.map((_, i) => `$${i + 2}`).join(", ");
  const result = await client.query(
    `select count(*)::bigint as n from metrics_raw r
       join metric_keys mk on mk.id = r.metric_id
      where r.device_id = $1 and mk.key in (${placeholders})`,
    [deviceId, ...configKeys],
  );
  return Number((result.rows[0] as { n: unknown } | undefined)?.n ?? 0);
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

// fallow-ignore-next-line unused-export -- re-exported so the backfill's callers get the drop gate from the module that owns the backfill; covered by ./backfill.test.ts.
export { mayDropLegacy };
