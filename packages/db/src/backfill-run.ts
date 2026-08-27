/**
 * THE BACKFILL'S DRIVER: carry the raw window, replay the buckets, refresh the
 * tiers — resuming wherever the last run stopped.
 *
 * The SQL-issuing half, separated from `./backfill.ts` the way `./replay-run.ts`
 * is separated from `./replay.ts`.
 *
 * ## Where it is proved, and at which layer
 *
 * The STATEMENTS are proved by executing them, because a SQL-text assertion
 * cannot prove a query runs and this release already shipped two 500s behind a
 * fully green suite that way (CONTRIBUTING.md §6): `apps/server/db-tests/
 * upgrade.test.ts` against a real TimescaleDB, plus the end-to-end rehearsal in
 * `scripts/upgrade-rehearsal.ts`, which runs the whole thing against a restored
 * addon-1.2.0 fixture and compares the result with committed ground truth.
 *
 * The DECISIONS are proved without one, in `./backfill-run.test.ts`, over the
 * structural `UpgradeClient` — the refusals, the stage transitions, the refresh
 * order, the watermark that makes a killed run resume, and the verification gate.
 * That file asserts on none of the statement strings; the double only decides
 * which seeded rows a statement is asking for, the way `./replay-run.test.ts` and
 * `./archive-import-io.test.ts` already do.
 *
 * WHY IT IS RESUMABLE, which is the only interesting thing about the control flow
 * here: this runs outside the addon's boot chain because it cannot fit in
 * `sunreye/config.yaml`'s 120 s Supervisor timeout, and it is therefore killable
 * at any moment by a restart, a timeout or a power cut. Every unit of work is one
 * transaction that commits its own `replay_progress` row with the rows it wrote,
 * so a killed chunk rolls back whole and the next run skips what is already
 * recorded. Measured: killed twice mid-run, the end state is row-for-row identical
 * to a single clean pass.
 */
import type { Span } from "./replay";
import { type ReplayOptions, type ReplayResult, runReplay } from "./replay-run";
import { LEGACY_NAME } from "./upgrade-120";
import {
  type CarryRawInput,
  type UpgradeClient,
  type UpgradeLogger,
  carryLegacyRaw,
  readMigrationRecord,
  writeMigrationRecord,
} from "./upgrade-120-run";
import { type MigrationRecord, migrationRecordSchema } from "./upgrade-state";
import {
  BUCKET_REPLAY_SOURCE,
  type BackfillInput,
  type CoverageRow,
  type NewTier,
  REFRESH_ORDER,
  REFRESH_SOURCE,
  compareCoverage,
  configLeak,
  refreshCall,
  refreshWindows,
} from "./backfill";

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
