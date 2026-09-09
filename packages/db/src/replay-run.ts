/**
 * BUCKET REPLAY, the execution half: the SQL that turns materialized 1.2.0
 * buckets into rows against the 2.0.0 schema, chunk by chunk, resumably.
 *
 * Read `./replay.ts` first — it holds the *why* and every decision that can be
 * decided without a database. This file is the part that must be proved by
 * running it, and it is: `apps/server/db-tests/replay.test.ts` executes every
 * statement below against a real TimescaleDB, and `scripts/replay-rehearsal.ts`
 * runs the whole thing against the real addon-1.2.0 fixture.
 *
 * ## Why SQL and not rows through TypeScript
 *
 * Two months of minute buckets for one device with ~108 metrics is ~9.3 M
 * buckets. At even 10 k rows per round trip that is 930 round trips carrying
 * every value twice across the wire; as `INSERT … SELECT` over the dimension
 * joins it is one statement per day, and the values never leave the server. The
 * arithmetic is still unit-tested, because it is not in here.
 *
 * ## The three things this file gets right
 *
 * 1. IDENTITY resolves through the real dimension tables. The metric name in a
 *    1.2.0 bucket is joined to `metric_keys.key`, per row, in the database —
 *    never mapped in process, because the map would be 108 entries against 9.3 M
 *    rows. The DEVICE, by contrast, is supplied by the caller as a resolved
 *    `device_id`: 1.2.0's `inverter_id` held the PROFILE id, and the mapping from
 *    a profile id to a device is exactly what an operator has to supply per
 *    install (see the header of `timescale/0000_baseline.sql`). Inventing it here
 *    would be guessing.
 * 2. CONFIG registers do not go back into the hypertable. At 1.2.0 configuration
 *    registers were still written to `metrics_raw`, so they are in the minute
 *    buckets too — 37 of one measured profile's 108 metrics. They are routed to
 *    `metrics_config_log` as CHANGES only, which is both what 2.0.0's writer does
 *    and what issue #150 asks for; the whole settings history collapses to a
 *    couple of hundred rows. WHICH keys those are is a profile decision
 *    (`resolveStorage`) handed in by the caller — never a `settings.%` prefix
 *    match, which is one vendor's naming and silently stops applying on the next.
 * 3. A CHUNK AND ITS WATERMARK COMMIT TOGETHER. See `./schema/replay.ts`.
 */

import { getTableName } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

import type { MetricKeyWriter } from "./metric-keys";

import {
  clampToCoverage,
  type BucketTier,
  type ReplayChunk,
  type Span,
  type TierWindow,
  assertIdentifier,
  bucketWidthMs,
  pendingChunks,
  planReplay,
} from "./replay";
import { metricsConfigLog, metricsRaw } from "./schema/metrics";
import { metricKeys } from "./schema/plants";
import { replayProgress } from "./schema/replay";

const METRICS_RAW = getTableName(metricsRaw);
const CONFIG_LOG = getTableName(metricsConfigLog);
const METRIC_KEYS = getTableName(metricKeys);
const PROGRESS = getTableName(replayProgress);

/**
 * The client this module needs: one statement, positional parameters, rows back.
 *
 * Structurally `pg.Client`'s own `query`, which is what `./migrate.ts` already
 * uses — so the in-place upgrade hands in the connection it already has. It must
 * be a SINGLE connection, not a pool: the chunk transaction is expressed as
 * `begin`/`commit` statements, and on a pool they could land on different
 * backends, which would silently drop the one property resumability rests on.
 */
export interface ReplayClient {
  query(text: string, values?: readonly unknown[]): Promise<{ rows: unknown[] }>;
}

/**
 * Adapt bun's `SQL` to {@link ReplayClient}.
 *
 * `bun:sqlite`-style clients return rows directly rather than a result object.
 * The database-test layer and `scripts/replay-rehearsal.ts` both hold a bun
 * `SQL`, and a wrapper each would be two chances to differ.
 */
export function bunSqlClient(sql: {
  unsafe(query: string, values?: unknown[]): Promise<unknown>;
}): ReplayClient {
  return {
    async query(text, values) {
      const rows = await sql.unsafe(text, values ? [...values] : []);
      return { rows: (Array.isArray(rows) ? rows : []) as unknown[] };
    },
  };
}

/** Renders drizzle `sql` templates to text + params. Stateless, so module-level. */
const dialect = new PgDialect();

/**
 * Present a {@link ReplayClient} as the client `./metric-keys.ts` wants.
 *
 * The replay REFUSES to run while a source metric is unregistered (see
 * {@link unregisteredMetrics}), so every caller needs to register keys through
 * the same connection it is about to replay on — and the one upsert that
 * guarantees ids are REUSED rather than churned lives in `ensureMetricKeys`,
 * behind a drizzle-shaped `execute`. Rendering the statement here is what lets
 * that one implementation serve both, instead of the replay growing a second
 * `insert … on conflict` that could drift from it.
 */
export function metricKeyWriter(client: ReplayClient): MetricKeyWriter {
  return {
    execute: async (query) => {
      const rendered = dialect.sqlToQuery(query);
      return client.query(rendered.sql, rendered.params);
    },
  };
}

/**
 * The column names a legacy bucket relation uses. Defaults are 1.2.0's own, from
 * `git show addon-v1.2.0:packages/db/src/timescale/0000_bootstrap.sql`.
 *
 * Configurable because the second transport over this module — `sunreye import`
 * — will land buckets in a staging table of its own, and because the in-place
 * upgrade may rename columns rather than relations. The `value` column is the
 * UNWEIGHTED `avg_value`, which for 1.2.0 data is the time-weighted mean; see
 * `./replay.ts`.
 */
export interface LegacyColumns {
  bucket: string;
  sourceId: string;
  metric: string;
  value: string;
}

const DEFAULT_LEGACY_COLUMNS: LegacyColumns = {
  bucket: "bucket",
  sourceId: "inverter_id",
  metric: "metric",
  value: "avg_value",
};

/** Which relation holds each tier's buckets. A tier with no relation is not used. */
export type TierRelations = Partial<Record<BucketTier, string>>;

export interface ReplayRequest {
  /**
   * Stable label for this replay source, recorded in the watermark.
   *
   * NOT the relation name: a run may read one day from `minute` and the next from
   * `hourly`, and both are the same source. Two different sources replaying into
   * one database (the upgrade's own buckets, and an imported file) must not see
   * each other's completed days.
   */
  source: string;
  relations: TierRelations;
  columns?: LegacyColumns;
  /** The 1.2.0 `inverter_id` to replay, and the `devices.id` it now means. */
  identity: { sourceId: string; deviceId: number };
  /**
   * Narrow the requested span to this source's own coverage instead of reporting
   * the remainder as gaps. Default false, which keeps the safety net: a caller
   * that names a span the tiers do not cover is told so.
   *
   * Set only where the bound is SHARED rather than a claim about this source —
   * the multi-source backfill passes one `replayTo` for every legacy id, and an
   * orphaned id may hold hours of it. See `./backfill-run.ts`.
   */
  clampToCoverage?: boolean;
  /** Metric keys the profile stores as configuration. Never a prefix match. */
  configKeys?: readonly string[];
  /** Replay only from here. Defaults to the earliest bucket any tier holds. */
  from?: Date;
  /** Replay only up to here, exclusive. Defaults to just past the latest bucket. */
  to?: Date;
  /**
   * The `dur_ms` every written row claims, instead of the tier's bucket width.
   *
   * For BUCKETS the width is the duration — a bucket's mean was held for the
   * bucket. But the same statements below also carry a 1.2.0 install's retained
   * RAW window forward (`../upgrade-120-run.ts`), where each row is one poll
   * sample and its duration is the poll cadence, which is an addon option (1 s on
   * a live install, 60 s on the fixture) and therefore measured rather than
   * declared. A second implementation of these two `INSERT … SELECT`s would be a
   * second answer to identity resolution, config routing and the watermark; one
   * optional width is not.
   *
   * `null` writes no duration at all — `metrics_raw.dur_ms` is nullable and the
   * readers already fall back, so an absent duration is a supported state and a
   * fabricated one is not. Omitted keeps the tier's width.
   */
  durMsOverride?: number | null;
}

export interface ChunkResult extends ReplayChunk {
  seriesRows: number;
  configRows: number;
  elapsedMs: number;
}

export interface ReplayResult {
  /** Chunks written by THIS run. */
  chunks: ChunkResult[];
  /** Chunks a previous run had already completed. */
  skipped: number;
  seriesRows: number;
  configRows: number;
  /** Days no tier could answer — reported, never skipped silently. */
  gaps: Span[];
  elapsedMs: number;
}

const num = (value: unknown): number => Number(value ?? 0);

/** `$n` placeholders for `count` parameters starting at `from`. */
const placeholders = (from: number, count: number): string =>
  Array.from({ length: count }, (_, i) => `$${from + i}`).join(", ");

function columnsOf(request: ReplayRequest): LegacyColumns {
  const columns = request.columns ?? DEFAULT_LEGACY_COLUMNS;
  for (const name of Object.values(columns)) assertIdentifier(name);
  return columns;
}

function relationFor(request: ReplayRequest, tier: BucketTier): string {
  const relation = request.relations[tier];
  if (relation === undefined) throw new Error(`replay: no relation configured for tier ${tier}`);
  return assertIdentifier(relation);
}

/**
 * What each configured tier actually holds for this source, so the plan can pick
 * the finest one per day.
 *
 * The window's exclusive end is the last bucket's START PLUS ITS WIDTH — a bucket
 * stamped 23:00 covers up to 00:00, and treating `max(bucket)` as the end would
 * leave the final hour of history unreplayed on every run.
 */
/**
 * Every distinct legacy source id the bucket relations hold, oldest span first.
 *
 * `inverter_id` held the PROFILE id, so a 1.x database that ever swapped or
 * renamed a profile carries more than one — and every one of them is the same
 * physical machine. Production carries two. Replaying only the id the migration
 * record names would leave the rest behind, and the legacy relations are dropped
 * at the end of the upgrade, so "left behind" means gone.
 *
 * Ordered by first bucket so the oldest history replays first, which keeps the
 * log readable and makes a partial run's watermarks contiguous in time.
 */
export async function legacySourceIds(
  client: ReplayClient,
  request: ReplayRequest,
): Promise<string[]> {
  const columns = columnsOf(request);
  const seen = new Map<string, number>();
  // Over the relations the REQUEST configures, rather than a tier list of our
  // own: the second transport over this module (`sunreye import`) supplies its
  // own staging relations, and a hard-coded tier list would quietly skip them.
  for (const relation of Object.values(request.relations)) {
    if (relation === undefined) continue;
    const result = await client.query(
      `select b.${columns.sourceId} as id, min(b.${columns.bucket}) as first
       from ${assertIdentifier(relation)} b
       where b.${columns.sourceId} is not null
       group by 1`,
    );
    for (const row of result.rows as { id: string; first: string | Date }[]) {
      const at = new Date(row.first as string).getTime();
      const previous = seen.get(row.id);
      if (previous === undefined || at < previous) seen.set(row.id, at);
    }
  }
  return [...seen.entries()].sort((a, b) => a[1] - b[1]).map(([id]) => id);
}

export async function readTierWindows(
  client: ReplayClient,
  request: ReplayRequest,
): Promise<TierWindow[]> {
  const columns = columnsOf(request);
  const windows: TierWindow[] = [];
  for (const tier of Object.keys(request.relations) as BucketTier[]) {
    const relation = relationFor(request, tier);
    const result = await client.query(
      `select min(b.${columns.bucket}) as "from", max(b.${columns.bucket}) as "to"
       from ${relation} b where b.${columns.sourceId} = $1`,
      [request.identity.sourceId],
    );
    const row = result.rows[0] as
      | { from: Date | string | null; to: Date | string | null }
      | undefined;
    if (!row?.from || !row?.to) continue;
    windows.push({
      tier,
      from: new Date(row.from),
      to: new Date(new Date(row.to).getTime() + bucketWidthMs(tier)),
    });
  }
  return windows;
}

/**
 * Metric keys present in the source that `metric_keys` does not hold.
 *
 * The replay REFUSES to run while any exist rather than letting the
 * `join metric_keys` drop those rows: a metric the current profile no longer
 * declares still has history, and history that disappears because a join found
 * no match is the quietest possible data loss. Registration itself is the
 * caller's, through `./metric-keys.ts` — the one upsert that guarantees ids are
 * reused rather than churned.
 */
export async function unregisteredMetrics(
  client: ReplayClient,
  request: ReplayRequest,
  tiers: readonly BucketTier[],
): Promise<string[]> {
  const columns = columnsOf(request);
  const missing = new Set<string>();
  for (const tier of tiers) {
    const relation = relationFor(request, tier);
    const result = await client.query(
      `select distinct b.${columns.metric} as metric
       from ${relation} b
       where b.${columns.sourceId} = $1
         and not exists (select 1 from ${METRIC_KEYS} mk where mk.key = b.${columns.metric})`,
      [request.identity.sourceId],
    );
    for (const row of result.rows as { metric: string }[]) missing.add(row.metric);
  }
  return [...missing].sort();
}

/** The chunk starts a previous run already committed, for this source and device. */
export async function completedChunks(
  client: ReplayClient,
  request: ReplayRequest,
): Promise<Set<string>> {
  const result = await client.query(
    `select chunk_start from ${PROGRESS} where source = $1 and device_id = $2`,
    [request.source, request.identity.deviceId],
  );
  return new Set(
    (result.rows as { chunk_start: Date | string }[]).map((row) =>
      new Date(row.chunk_start).toISOString(),
    ),
  );
}

/**
 * Replay one chunk: series rows, config changes and the watermark, in ONE
 * transaction.
 *
 * On any failure the transaction is rolled back and the error rethrown, so the
 * chunk keeps no watermark row and the next run redoes exactly it. That — and
 * not a retry loop — is what makes a killed process safe.
 */
export async function replayChunk(
  client: ReplayClient,
  request: ReplayRequest,
  chunk: ReplayChunk,
): Promise<ChunkResult> {
  const began = Date.now();
  await client.query("begin");
  try {
    const seriesRows = await insertSeries(client, request, chunk);
    const configRows = await insertConfigChanges(client, request, chunk);
    const elapsedMs = Date.now() - began;
    await client.query(
      `insert into ${PROGRESS}
         (source, device_id, chunk_start, chunk_end, tier, series_rows, config_rows, elapsed_ms)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        request.source,
        request.identity.deviceId,
        chunk.start.toISOString(),
        chunk.end.toISOString(),
        chunk.tier,
        seriesRows,
        configRows,
        elapsedMs,
      ],
    );
    await client.query("commit");
    return { ...chunk, seriesRows, configRows, elapsedMs };
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}

/**
 * The series arm: one `metrics_raw` row per bucket, stamped at bucket start with
 * `dur_ms` = the tier's width.
 *
 * `count(*)` over a `returning` CTE rather than a driver rowcount: `pg` reports
 * one and bun's `SQL` reports another, and the number goes into the watermark
 * row, so it has to come from the database either way.
 */
async function insertSeries(
  client: ReplayClient,
  request: ReplayRequest,
  chunk: ReplayChunk,
): Promise<number> {
  const columns = columnsOf(request);
  const relation = relationFor(request, chunk.tier);
  const configKeys = request.configKeys ?? [];
  const params: unknown[] = [
    request.identity.sourceId,
    chunk.start.toISOString(),
    chunk.end.toISOString(),
    request.identity.deviceId,
    request.durMsOverride === undefined ? bucketWidthMs(chunk.tier) : request.durMsOverride,
    ...configKeys,
  ];
  const exclude =
    configKeys.length === 0
      ? ""
      : `and b.${columns.metric} not in (${placeholders(6, configKeys.length)})`;
  const result = await client.query(
    `with ins as (
       insert into ${METRICS_RAW} (time, value, dur_ms, device_id, metric_id)
       select b.${columns.bucket}, b.${columns.value}, $5::integer, $4::smallint, mk.id
       from ${relation} b
       join ${METRIC_KEYS} mk on mk.key = b.${columns.metric}
       where b.${columns.sourceId} = $1
         and b.${columns.bucket} >= $2 and b.${columns.bucket} < $3
         and b.${columns.value} is not null
         ${exclude}
       returning 1
     )
     select count(*)::bigint as n from ins`,
    params,
  );
  return num((result.rows[0] as { n: unknown } | undefined)?.n);
}

/**
 * The config arm: one `metrics_config_log` row per CHANGE, not per bucket.
 *
 * Two comparisons, and the second is the one that is easy to miss. `lag()` covers
 * changes inside the chunk; `prior` is the last value already logged BEFORE the
 * chunk, so the first bucket of a day is only written when it differs from
 * yesterday's last value. Without it a day-chunked replay would emit one row per
 * config metric per day — hundreds of rows saying nothing changed — and the whole
 * point of the change-log is that it holds only information.
 *
 * `prior` is correct rather than approximate because chunks run in ascending time
 * order and each commits before the next begins, so everything before this chunk
 * is already in the table.
 */
async function insertConfigChanges(
  client: ReplayClient,
  request: ReplayRequest,
  chunk: ReplayChunk,
): Promise<number> {
  const configKeys = request.configKeys ?? [];
  if (configKeys.length === 0) return 0;
  const columns = columnsOf(request);
  const relation = relationFor(request, chunk.tier);
  const result = await client.query(
    `with src as (
       select b.${columns.bucket} as bucket, b.${columns.metric} as metric,
              b.${columns.value} as value,
              lag(b.${columns.value}) over (
                partition by b.${columns.metric} order by b.${columns.bucket}
              ) as prev
       from ${relation} b
       where b.${columns.sourceId} = $1
         and b.${columns.bucket} >= $2 and b.${columns.bucket} < $3
         and b.${columns.value} is not null
         and b.${columns.metric} in (${placeholders(5, configKeys.length)})
     ),
     prior as (
       select distinct on (l.metric_id) mk.key as metric, l.value
       from ${CONFIG_LOG} l
       join ${METRIC_KEYS} mk on mk.id = l.metric_id
       where l.device_id = $4 and l.time < $2
       order by l.metric_id, l.time desc
     ),
     ins as (
       insert into ${CONFIG_LOG} (time, value, device_id, metric_id)
       select s.bucket, s.value, $4::smallint, mk.id
       from src s
       join ${METRIC_KEYS} mk on mk.key = s.metric
       left join prior p on p.metric = s.metric
       where case when s.prev is null then p.value is null or s.value <> p.value
                  else s.value <> s.prev end
       returning 1
     )
     select count(*)::bigint as n from ins`,
    [
      request.identity.sourceId,
      chunk.start.toISOString(),
      chunk.end.toISOString(),
      request.identity.deviceId,
      ...configKeys,
    ],
  );
  return num((result.rows[0] as { n: unknown } | undefined)?.n);
}

export interface ReplayOptions {
  /** Called after each chunk commits — the hook a CLI draws a progress line from. */
  onChunk?: (result: ChunkResult, index: number, total: number) => void;
}

/**
 * Replay a source, resuming wherever the last run stopped.
 *
 * The order is not incidental: windows are read first (so the plan uses the
 * finest tier that actually still holds each day), then every metric key is
 * checked (so the run refuses BEFORE writing anything rather than half way
 * through), then completed chunks are subtracted, then the remaining chunks run
 * in ascending time order — which the config arm's `prior` lookup depends on.
 */
export async function runReplay(
  client: ReplayClient,
  request: ReplayRequest,
  options: ReplayOptions = {},
): Promise<ReplayResult> {
  const began = Date.now();
  const windows = await readTierWindows(client, request);
  if (windows.length === 0) {
    return { chunks: [], skipped: 0, seriesRows: 0, configRows: 0, gaps: [], elapsedMs: 0 };
  }
  const earliest = new Date(Math.min(...windows.map((w) => w.from.getTime())));
  const latest = new Date(Math.max(...windows.map((w) => w.to.getTime())));
  // Clamped to this source's own coverage: `request.to` is the migration
  // record's `replayTo` and is the same for every source id, while an orphaned id
  // may hold only hours. See `clampToCoverage`.
  const span = request.clampToCoverage
    ? clampToCoverage(
        { from: request.from ?? earliest, to: request.to ?? latest },
        { from: earliest, to: latest },
      )
    : { from: request.from ?? earliest, to: request.to ?? latest };
  const plan = planReplay({ from: span.from, to: span.to, windows });

  const tiers = [...new Set(plan.chunks.map((chunk) => chunk.tier))];
  const missing = await unregisteredMetrics(client, request, tiers);
  if (missing.length > 0) {
    throw new Error(
      `replay: ${missing.length} metric key(s) in the source are not registered in ` +
        `${METRIC_KEYS}, so their history would be silently dropped: ${missing.join(", ")}`,
    );
  }

  const done = await completedChunks(client, request);
  const todo = pendingChunks(plan.chunks, done);
  const results: ChunkResult[] = [];
  for (const [index, chunk] of todo.entries()) {
    const result = await replayChunk(client, request, chunk);
    results.push(result);
    options.onChunk?.(result, index, todo.length);
  }
  return {
    chunks: results,
    skipped: plan.chunks.length - todo.length,
    seriesRows: results.reduce((sum, r) => sum + r.seriesRows, 0),
    configRows: results.reduce((sum, r) => sum + r.configRows, 0),
    gaps: plan.gaps,
    elapsedMs: Date.now() - began,
  };
}
