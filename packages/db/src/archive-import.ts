/**
 * THE IMPORTER: a portable archive back into a 2.0.0 database.
 *
 * Read `./archive.ts` (format), `./archive-config.ts` (graph), `./archive-file.ts`
 * (container) and `./archive-export.ts` (the other end) first.
 *
 * ## This is a SECOND TRANSPORT over the bucket replay, not a second replay
 *
 * `./replay.ts` + `./replay-run.ts` already turn materialized aggregate buckets
 * into `metrics_raw` interval rows — one row per bucket at BUCKET START with
 * `dur_ms` = the bucket width, chunked by UTC day, resumable through
 * `replay_progress`, with configuration registers routed to
 * `metrics_config_log` as CHANGES only. The in-place upgrade is the first
 * transport over that module; this file is the second, and `LegacyColumns` exists
 * in `replay-run.ts` precisely so this one can name its own columns.
 *
 * So a bucket row does NOT get inserted here. It is landed in a per-tier STAGING
 * table and `runReplay` is called over those. Two implementations of that
 * arithmetic is the failure the whole ordering of this release exists to prevent,
 * and the arithmetic in question is the one that decides whether a day with a
 * counter reset reports 41.971 kWh or 64280.971.
 *
 * A `raw` row is different and is inserted directly: there is no bucket, no
 * width to derive and nothing to collapse — it already carries its own `dur_ms`.
 *
 * ## THE ORDER BELOW IS LOAD-BEARING AND EVERY FAILURE IN IT IS SILENT
 *
 *  1. CONFIG FIRST, so the dimension spine exists. Every reading names a device
 *     by slug and a metric by key; without the rows to resolve them against, the
 *     joins would drop every row and report success.
 *  2. REFUSE ON AN UNKNOWN IDENTITY, before a single insert. `replay-run.ts`
 *     makes the same refusal for the same reason.
 *  3. RAW BEFORE THE COMPRESSION POLICY IS ARMED. Inserting into a compressed
 *     chunk is slow at best; `DELETE`/`UPDATE` in place on one silently aborts
 *     past ~100 k tuples. The importer therefore DISARMS `metrics_raw`'s
 *     compression policy for the duration and re-arms it at the end.
 *  4. REFRESH THE AGGREGATES MANUALLY, over the WHOLE span. The refresh policies
 *     cover only their recent `start_offset` (3 hours for minute and hourly, 3
 *     days for daily) and will NEVER reach imported history. Without this step
 *     every chart is empty and `metrics_raw` is full — the most confusing
 *     possible outcome. Bounded, never `(NULL, NULL)`, and hourly before daily
 *     because `daily_rollups` reads `hourly_rollups`.
 *  5. WARN ABOUT RETENTION. Retention runs on imported rows too: anything older
 *     than `drop_after` is DELETED by the next job, not rejected at insert. See
 *     {@link retentionWarning} — this is the one thing nothing else would ever
 *     tell the operator.
 */

import { createHash } from "node:crypto";
import {
  type ArchiveManifest,
  type ConfigLogRow,
  MEMBERS,
  type ReadingRow,
  type SourceTier,
  type StreamCounts,
  decodeConfigLog,
  decodeReading,
  emptyStreamCounts,
  totalReadings,
  unknownIdentities,
} from "./archive";
import {
  type ArchiveConfig,
  type ArchiveConnection,
  type ArchiveDevice,
  type ArchivePlant,
  parseArchiveConfig,
} from "./archive-config";
import { type OpenArchive, openArchive } from "./archive-file";
import { ensureMetricKeys } from "./metric-keys";
import {
  type LegacyColumns,
  type ReplayClient,
  type ReplayResult,
  metricKeyWriter,
  runReplay,
} from "./replay-run";
import { assertIdentifier } from "./replay";

/**
 * Rows per `INSERT … VALUES` batch.
 *
 * `metrics_raw` takes five parameters a row against Postgres's 65535-parameter
 * ceiling, so 10 000 is a third of the headroom — big enough that the round trips
 * disappear against 9 M rows, small enough that a batch is never the thing that
 * fails.
 */
export const BATCH_ROWS = 10_000;

/** Where each bucket tier's rows are staged for the replay to read. */
export const STAGE_TABLE: Record<Exclude<SourceTier, "raw">, string> = {
  minute: "archive_stage_minute",
  hourly: "archive_stage_hourly",
  daily: "archive_stage_daily",
};

/**
 * The column names the staging tables use — the archive's own field names.
 *
 * `replay-run.ts`'s `LegacyColumns` is configurable exactly so this transport can
 * do this rather than pretend to be 1.2.0's rollups. Naming the staging columns
 * after the file's fields means there is one fewer mapping in the world to get
 * wrong.
 */
export const stageColumns = (): LegacyColumns => ({
  bucket: "time",
  sourceId: "device_slug",
  metric: "metric_key",
  value: "value",
});

/** Fixed-size batches. An empty input yields none — `VALUES ()` is a syntax error. */
export function* batchesOf<T>(items: readonly T[], size = BATCH_ROWS): Generator<T[]> {
  for (let i = 0; i < items.length; i += size) yield items.slice(i, i + size);
}

/**
 * The replay `source` this archive counts as.
 *
 * Deliberately derived from the archive's CONTENT rather than from its filename
 * or its `createdAt`. Two consequences, and both are the intended ones:
 *
 *  * re-exporting an UNCHANGED database and importing that file again is a
 *    no-op, because it hashes to the same source and every chunk is already
 *    watermarked;
 *  * an archive covering MORE history is a different source, because it is
 *    genuinely different data — and `overlapVerdict` is what stops it landing on
 *    top of the first one.
 *
 * `createdAt` is excluded for the first reason. The span, the counts, the devices
 * and the metrics are included because a change in any of them means the file
 * says something different.
 */
export function archiveSourceId(manifest: ArchiveManifest): string {
  const identity = JSON.stringify({
    formatVersion: manifest.formatVersion,
    span: manifest.span,
    streams: manifest.streams,
    devices: manifest.devices,
    metrics: manifest.metrics,
  });
  // Prefixed so two sources replaying into one database — the in-place upgrade's
  // own buckets and an imported file — can never see each other's watermarks.
  return `archive:${createHash("sha256").update(identity).digest("hex").slice(0, 32)}`;
}

/**
 * The source a COMPLETION marker is recorded under — one row per device, written
 * only after every arm of the import has finished.
 *
 * Separate from the bucket arm's own per-chunk watermarks, and the separation is
 * the whole point. `runReplay` writes one watermark per UTC day as it goes, so
 * "some watermarks exist" means SOME PROGRESS, never completion — and reading it
 * as completion is how a half-finished import gets skipped on the retry that was
 * supposed to fix it, leaving the operator with a chart that is quietly short and
 * an importer that says "nothing to do".
 *
 * So completion is recorded explicitly, at the end, and it is the only thing that
 * licenses a skip. It also gives a RAW-ONLY archive — which is what a 2.0.0
 * export of a recent span is — an idempotency story at all: it has no bucket
 * chunks, so without this marker a retried import could only ever be refused.
 *
 * A distinct source string rather than a distinct tier, because the bucket arm's
 * watermark is keyed `(source, device_id, chunk_start)` and a marker sharing that
 * source could collide with a real chunk's primary key.
 */
export const doneSourceId = (source: string): string => `${source}#done`;

export interface OverlapInput {
  /** Rows the target already holds inside the archive's span, for its devices. */
  overlappingRows: number;
  /**
   * Devices this archive has a COMPLETION marker for — never a count of partial
   * per-chunk watermarks. See {@link doneSourceId}.
   */
  completedDevices: number;
  /** Devices the archive names, i.e. how many markers a finished import leaves. */
  expectedDevices: number;
  /**
   * Per-chunk watermarks recorded for this archive's bucket arm. Evidence of
   * PROGRESS, and the thing that distinguishes "someone tried and died" from "the
   * span belongs to something else entirely".
   */
  partialChunks: number;
  force: boolean;
}

export type OverlapVerdict =
  | { action: "proceed"; reason?: string }
  | { action: "skip"; reason: string }
  | { action: "refuse"; reason: string };

/**
 * Whether to import, skip, or refuse.
 *
 * IDEMPOTENT-OR-REFUSE, and here is the justification, because the task of
 * choosing is half the work.
 *
 * `metrics_raw` has no unique constraint — it cannot have one, because two
 * genuine samples of the same metric at the same instant from the same device do
 * not exist but proving that in a constraint would cost an index on the hottest
 * write path in the app. So a second import of overlapping history CANNOT be
 * deduplicated by the database. It would double every row, and a doubled series
 * does not error: `time_weight` reports the same mean and `counter_agg` reports a
 * plausible-looking delta, so the damage surfaces months later as a kWh figure
 * nobody can explain.
 *
 * Given that, "merge" is not on the table and the only honest options are
 * idempotent or refuse. This does both, split on evidence rather than on a flag:
 *
 *  * ALREADY IMPORTED (a watermark for this exact source, and nothing missing) →
 *    SKIP. A retried import must not look broken.
 *  * A CLEAN SPAN → proceed.
 *  * ANYTHING ELSE (rows from another source, or a PARTIAL previous run of this
 *    one) → REFUSE, with the row count and the recourse in the message. A partial
 *    run is refused rather than resumed because resuming is right for the bucket
 *    arm (whose chunks are watermarked) and a double count for the raw arm (whose
 *    watermark is written only once, at the end), and this importer will not
 *    guess which half was interrupted.
 *
 * `--force` exists for the operator who has decided the duplicates are
 * acceptable, and it says so rather than pretending to be clever.
 */
export function overlapVerdict(input: OverlapInput): OverlapVerdict {
  // COMPLETION, not progress. Every device the archive names has to carry a
  // marker; one missing means the import stopped somewhere and the retry must be
  // allowed to notice.
  if (input.expectedDevices > 0 && input.completedDevices >= input.expectedDevices) {
    return {
      action: "skip",
      reason:
        `this archive was already imported in full (${input.completedDevices} of ` +
        `${input.expectedDevices} device(s) carry its completion marker) — nothing to do`,
    };
  }
  if (input.overlappingRows === 0) return { action: "proceed" };
  if (input.force) {
    return {
      action: "proceed",
      reason:
        `--force: importing over ${input.overlappingRows} existing row(s) in the archive's span. ` +
        `metrics_raw has no unique key, so these will be DUPLICATE rows, not replacements.`,
    };
  }
  if (input.partialChunks > 0 || input.completedDevices > 0) {
    return {
      action: "refuse",
      reason:
        `a previous import of this archive is INCOMPLETE: ${input.partialChunks} chunk(s) and ` +
        `${input.completedDevices} of ${input.expectedDevices} device marker(s) recorded, with ` +
        `${input.overlappingRows} row(s) already in the span. Resuming would be correct for the ` +
        `bucket tiers and a double count for the raw tier, so this is refused rather than ` +
        `guessed. Reset the time-series and import again, or pass --force to accept duplicate rows.`,
    };
  }
  return {
    action: "refuse",
    reason:
      `the target already holds ${input.overlappingRows} row(s) inside the archive's span, for ` +
      `devices the archive names. metrics_raw has no unique key, so importing would DUPLICATE ` +
      `rather than replace them — and a doubled series does not error, it just reports a wrong ` +
      `kWh figure later. Import into an empty database, or pass --force to accept duplicate rows.`,
  };
}

export interface RetentionInput {
  /** Oldest reading the archive holds, or null when it holds none. */
  oldest: Date | null;
  /** `metrics_raw`'s retention in days, or null when no policy is armed. */
  rawRetentionDays: number | null;
  now: Date;
}

/**
 * What retention will do to the oldest imported rows, as a sentence — or null.
 *
 * This is the one consequence nothing else in the system would ever surface.
 * Retention is not an insert-time constraint: rows older than `drop_after` are
 * accepted, committed, counted in the import's own report, visible on a chart —
 * and then DELETED by the next scheduled `policy_retention` run, silently. An
 * operator restoring a decade of history onto a 5-year policy would watch half
 * of it disappear overnight with nothing in the log tying the two events
 * together.
 */
export function retentionWarning(input: RetentionInput): string | null {
  if (input.oldest === null || input.rawRetentionDays === null) return null;
  const cutoff = input.now.getTime() - input.rawRetentionDays * 86_400_000;
  if (input.oldest.getTime() >= cutoff) return null;
  return (
    `the archive's oldest reading is ${input.oldest.toISOString().slice(0, 10)}, which is past ` +
    `metrics_raw's ${input.rawRetentionDays}-day retention. Those rows WILL BE IMPORTED and ` +
    `then DELETED by the next retention job — retention is not checked at insert. To keep ` +
    `them, raise the retention interval in packages/db/src/timescale/policies.sql (it is ` +
    `re-applied on every migrate run) BEFORE the next job window.`
  );
}

// ---------------------------------------------------------------------------
// The IO half.
// ---------------------------------------------------------------------------

export interface ImportRequest {
  /** The `.tar.gz` to read. */
  file: string;
  /** Scratch directory. Created and removed by this function. */
  workDir: string;
  /**
   * Rename devices on the way in: archive slug -> target slug. The seam a
   * Victron/Sigenergy install uses to split one imported device into several.
   */
  deviceMap?: Readonly<Record<string, string>>;
  /** Refresh the aggregates over the imported span. Default true — see the header. */
  refresh?: boolean;
  /** Accept duplicate rows over an existing span. See {@link overlapVerdict}. */
  force?: boolean;
  /** Apply `config.json` (plant graph, settings, profiles, charts). Default true. */
  applyConfig?: boolean;
  onProgress?: (progress: { stage: string; rows: number }) => void;
}

export interface ImportResult {
  manifest: ArchiveManifest;
  /** What was actually written, per stream. Compared against the manifest. */
  inserted: StreamCounts;
  /** Replay results, one per device that had bucket rows. */
  replays: ReplayResult[];
  /** Non-fatal findings: config oddities, gaps, the retention warning. */
  problems: string[];
  /** Set when the archive had already been imported and nothing was written. */
  skipped: string | null;
  elapsedMs: number;
}

const num = (value: unknown): number => Number(value ?? 0);

async function scalar(client: ReplayClient, query: string, values?: unknown[]): Promise<unknown> {
  const result = await client.query(query, values);
  const row = result.rows[0] as Record<string, unknown> | undefined;
  return row ? Object.values(row)[0] : undefined;
}

/**
 * `metrics_raw`'s retention in days, read from the live policy.
 *
 * From the catalogue rather than from a constant, because
 * `timescale/policies.sql` is re-applied on every migrate run and a constant here
 * would go stale the first time someone retunes it — which is exactly the
 * scenario the warning exists for.
 */
async function rawRetentionDays(client: ReplayClient): Promise<number | null> {
  try {
    const value = await scalar(
      client,
      `select (config->>'drop_after')::interval as d
       from timescaledb_information.jobs
       where proc_name = 'policy_retention' and hypertable_name = 'metrics_raw' limit 1`,
    );
    if (value === null || value === undefined) return null;
    const days = await scalar(client, `select extract(epoch from $1::interval) / 86400 as d`, [
      String(value),
    ]);
    const parsed = Number(days);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Upsert the plant row itself, returning its id. */
async function upsertPlant(client: ReplayClient, plant: ArchivePlant): Promise<number> {
  return num(
    await scalar(
      client,
      `insert into plants (name, slug, time_zone, latitude, longitude, label, arrays,
                           temp_coefficient, system_loss, max_output_w, house_load_w,
                           smart_meter_since, bidding_zone, tariff_key)
       values ($1,$2,$3,$4,$5,$6,$7::jsonb,
               coalesce($8, -0.4), coalesce($9, 14), $10, $11, $12, $13, $14)
       on conflict (slug) do update set
         name = excluded.name, time_zone = excluded.time_zone,
         latitude = excluded.latitude, longitude = excluded.longitude,
         label = excluded.label, arrays = excluded.arrays,
         temp_coefficient = excluded.temp_coefficient, system_loss = excluded.system_loss,
         max_output_w = excluded.max_output_w, house_load_w = excluded.house_load_w,
         smart_meter_since = excluded.smart_meter_since,
         bidding_zone = excluded.bidding_zone, tariff_key = excluded.tariff_key
       returning id`,
      [
        plant.name,
        plant.slug,
        plant.timeZone,
        plant.latitude,
        plant.longitude,
        plant.label,
        JSON.stringify(plant.arrays ?? []),
        plant.tempCoefficient,
        plant.systemLoss,
        plant.maxOutputW,
        plant.houseLoadW,
        plant.smartMeterSince,
        plant.biddingZone,
        plant.tariffKey,
      ],
    ),
  );
}

/**
 * The endpoints, BY NAME, returning `name -> id`.
 *
 * A select-then-insert rather than an upsert: `connections` has no unique key on
 * `(plant_id, name)` — a plant legitimately has two endpoints with the same label
 * on different hosts — so there is no conflict target to name.
 */
async function upsertConnections(
  client: ReplayClient,
  plantId: number,
  connections: readonly ArchiveConnection[],
): Promise<Map<string, number>> {
  const ids = new Map<string, number>();
  for (const connection of connections) {
    const existing = await scalar(
      client,
      `select id from connections where plant_id = $1 and name = $2 order by id limit 1`,
      [plantId, connection.name],
    );
    const id =
      existing === undefined || existing === null
        ? num(
            await scalar(
              client,
              `insert into connections (plant_id, name, host, port, transport, timeout_ms,
                                        poll_interval_ms)
               values ($1,$2,$3,$4,$5,$6,$7) returning id`,
              [
                plantId,
                connection.name,
                connection.host,
                connection.port,
                connection.transport,
                connection.timeoutMs,
                connection.pollIntervalMs,
              ],
            ),
          )
        : num(existing);
    ids.set(connection.name, id);
  }
  return ids;
}

/** One device and, when it reports one, its battery pack. */
async function upsertDevice(
  client: ReplayClient,
  plantId: number,
  device: ArchiveDevice,
  connectionIds: ReadonlyMap<string, number>,
): Promise<void> {
  const connectionId =
    device.connection === null ? null : (connectionIds.get(device.connection) ?? null);
  const deviceId = num(
    await scalar(
      client,
      `insert into devices (plant_id, connection_id, unit_id, slug, name, profile_id, serial, role)
       values ($1,$2,$3,$4,$5,$6,$7,$8)
       on conflict (plant_id, slug) do update set
         connection_id = excluded.connection_id, unit_id = excluded.unit_id,
         name = excluded.name, profile_id = excluded.profile_id,
         serial = excluded.serial, role = excluded.role
       returning id`,
      [
        plantId,
        connectionId,
        device.unitId,
        device.slug,
        device.name,
        device.profileId,
        device.serial,
        device.role,
      ],
    ),
  );
  if (device.battery === null) return;
  await client.query(
    `insert into batteries (device_id, usable_kwh, max_charge_w, min_soc, nominal_v)
     values ($1,$2,$3,$4,$5)
     on conflict (device_id) do update set
       usable_kwh = excluded.usable_kwh, max_charge_w = excluded.max_charge_w,
       min_soc = excluded.min_soc, nominal_v = excluded.nominal_v`,
    [
      deviceId,
      device.battery.usableKwh,
      device.battery.maxChargeW,
      device.battery.minSoc,
      device.battery.nominalV,
    ],
  );
}

/** The whole plant graph: plant, endpoints by name, devices with their packs. */
async function applyPlant(client: ReplayClient, plant: ArchivePlant): Promise<number> {
  const plantId = await upsertPlant(client, plant);
  const connectionIds = await upsertConnections(client, plantId, plant.connections);
  for (const device of plant.devices) {
    await upsertDevice(client, plantId, device, connectionIds);
  }
  return plantId;
}

/** Settings, profiles, charts and the metric vocabulary. */
async function applyConfigRows(client: ReplayClient, config: ArchiveConfig): Promise<void> {
  for (const setting of config.appSettings) {
    await client.query(
      `insert into app_settings (key, value) values ($1, $2::jsonb)
       on conflict (key) do update set value = excluded.value, updated_at = now()`,
      [setting.key, JSON.stringify(setting.value ?? null)],
    );
  }
  for (const profile of config.installedProfiles) {
    await client.query(
      `insert into installed_profiles (id, source, version, data) values ($1,$2,$3,$4::jsonb)
       on conflict (id) do update set source = excluded.source, version = excluded.version,
         data = excluded.data`,
      [profile.id, profile.source, profile.version, JSON.stringify(profile.data ?? {})],
    );
  }
  for (const chart of config.customCharts) {
    await client.query(
      `insert into custom_charts (id, name, data) values ($1,$2,$3::jsonb)
       on conflict (id) do update set name = excluded.name, data = excluded.data,
         updated_at = now()`,
      [chart.id, chart.name, JSON.stringify(chart.data ?? {})],
    );
  }
  // Through `ensureMetricKeys`, because its `ON CONFLICT (key) DO UPDATE` is the
  // one thing guaranteeing ids are REUSED rather than renumbered — int2 caps the
  // dimension at 32767, which is ample only while ids never churn.
  if (config.metricKeys.length > 0) {
    await ensureMetricKeys(metricKeyWriter(client), config.metricKeys);
  }
}

/** `slug -> devices.id`, for the slugs the archive names. */
async function resolveDevices(
  client: ReplayClient,
  slugs: readonly string[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (slugs.length === 0) return out;
  const result = await client.query(
    `select slug, min(id) as id from devices where slug in (${paramList(1, slugs.length)})
     group by slug`,
    [...slugs],
  );
  for (const row of result.rows as { slug: string; id: unknown }[]) {
    out.set(row.slug, num(row.id));
  }
  return out;
}

async function knownMetricKeys(client: ReplayClient): Promise<Set<string>> {
  const result = await client.query("select key from metric_keys");
  return new Set((result.rows as { key: string }[]).map((row) => row.key));
}

/**
 * Create the staging tables, dropped first so a previous run's rows can never be
 * replayed a second time.
 *
 * UNLOGGED, and that is the single biggest lever in the whole import. A logged
 * `INSERT` of 8.16 M rows writes every row to the WAL as well as to the heap —
 * another full copy of the history, on a box whose disk is the binding
 * constraint. The staging table is pure scratch: it is truncated by a crash
 * (which is what UNLOGGED means) and dropped on success, and an interrupted
 * import is refused rather than resumed anyway (see {@link overlapVerdict}), so
 * there is nothing a crash could take that the import was going to keep.
 *
 * Plain tables rather than TEMPORARY ones: `runReplay` opens its own
 * `begin`/`commit` per chunk and a TEMP table would survive that fine, but a
 * plain table also means an interrupted import leaves the staged rows where an
 * operator can look at them. They are dropped at the end of a successful run.
 */
async function createStaging(client: ReplayClient, tiers: readonly string[]): Promise<void> {
  const columns = stageColumns();
  for (const tier of tiers) {
    const table = assertIdentifier(STAGE_TABLE[tier as Exclude<SourceTier, "raw">]);
    await client.query(`drop table if exists ${table}`);
    await client.query(
      `create unlogged table ${table} (
         ${columns.bucket} timestamptz not null,
         ${columns.sourceId} text not null,
         ${columns.metric} text not null,
         ${columns.value} double precision
       )`,
    );
  }
}

/** The index the replay's per-day, per-source read needs. Created AFTER the load. */
async function indexStaging(client: ReplayClient, tiers: readonly string[]): Promise<void> {
  const columns = stageColumns();
  for (const tier of tiers) {
    const table = assertIdentifier(STAGE_TABLE[tier as Exclude<SourceTier, "raw">]);
    await client.query(`create index on ${table} (${columns.sourceId}, ${columns.bucket})`);
  }
}

async function dropStaging(client: ReplayClient, tiers: readonly string[]): Promise<void> {
  for (const tier of tiers) {
    await client.query(
      `drop table if exists ${assertIdentifier(STAGE_TABLE[tier as Exclude<SourceTier, "raw">])}`,
    );
  }
}

/**
 * `$1, $2, …` for a flat parameter list starting at `from`.
 *
 * Used instead of `= any($1::text[])` and deliberately so: bun's `SQL` flattens a
 * single-element array parameter into a scalar, so `any($1::text[])` fails with
 * "malformed array literal" on exactly the one-device install this feature is
 * built for. A flat list has no such ambiguity on any driver.
 */
const paramList = (from: number, count: number): string =>
  Array.from({ length: count }, (_, i) => `$${from + i}`).join(", ");

const placeholders = (rows: number, columns: number): string =>
  Array.from(
    { length: rows },
    (_, r) =>
      `(${Array.from({ length: columns }, (_, c) => `$${r * columns + c + 1}`).join(", ")})`,
  ).join(", ");

/**
 * One multi-row `INSERT`, batched.
 *
 * The three inserts this import makes — raw readings, staged buckets, config
 * changes — differ only in their relation, their column list and how a row maps
 * to a values tuple. They were three copies of the same batching loop; this is
 * the loop, once. Rows are already batched by {@link batchWriter} on the way in,
 * so the second level of batching here is the belt for any caller that hands over
 * more than {@link BATCH_ROWS} at once.
 */
async function insertRows<T>(
  client: ReplayClient,
  relation: string,
  columns: readonly string[],
  rows: readonly T[],
  toValues: (row: T) => readonly unknown[],
): Promise<number> {
  let written = 0;
  for (const batch of batchesOf(rows)) {
    const values: unknown[] = [];
    for (const row of batch) values.push(...toValues(row));
    await client.query(
      `insert into ${relation} (${columns.join(", ")})
       values ${placeholders(batch.length, columns.length)}`,
      values,
    );
    written += batch.length;
  }
  return written;
}

/** Raw readings straight into `metrics_raw`, ids resolved in process. */
const insertRaw = (
  client: ReplayClient,
  rows: readonly ReadingRow[],
  devices: ReadonlyMap<string, number>,
  metrics: ReadonlyMap<string, number>,
): Promise<number> =>
  insertRows(
    client,
    "metrics_raw",
    ["time", "value", "dur_ms", "device_id", "metric_id"],
    rows,
    (row) => [
      row.time.toISOString(),
      row.value,
      row.durMs,
      devices.get(row.deviceSlug),
      metrics.get(row.metricKey),
    ],
  );

/** Bucket readings into their tier's staging table, BY NAME — the replay resolves ids. */
const insertStage = (
  client: ReplayClient,
  tier: Exclude<SourceTier, "raw">,
  rows: readonly ReadingRow[],
): Promise<number> => {
  const columns = stageColumns();
  return insertRows(
    client,
    assertIdentifier(STAGE_TABLE[tier]),
    [columns.bucket, columns.sourceId, columns.metric, columns.value],
    rows,
    (row) => [row.time.toISOString(), row.deviceSlug, row.metricKey, row.value],
  );
};

/** Configuration changes into `metrics_config_log`. */
const insertConfigLog = (
  client: ReplayClient,
  rows: readonly ConfigLogRow[],
  devices: ReadonlyMap<string, number>,
  metrics: ReadonlyMap<string, number>,
): Promise<number> =>
  insertRows(
    client,
    "metrics_config_log",
    ["time", "value", "device_id", "metric_id"],
    rows,
    (row) => [
      row.time.toISOString(),
      row.value,
      devices.get(row.deviceSlug),
      metrics.get(row.metricKey),
    ],
  );

/**
 * Refresh the tiers over `[from, to)`, BOUNDED and in dependency order.
 *
 * `(NULL, NULL)` is never used: it advances the watermark past everything, which
 * makes a real-time-aggregation test unable to fail and — more to the point here
 * — refreshes regions that hold nothing. Bounded to the imported span is both
 * faster and honest.
 *
 * hourly BEFORE daily, because `daily_rollups` is a hierarchical aggregate over
 * `hourly_rollups`: refreshing daily first would materialize days from hourly
 * buckets that do not exist yet, and no later refresh is guaranteed to correct
 * them.
 */
export async function refreshAggregates(
  client: ReplayClient,
  span: { from: Date; to: Date },
  onProgress?: (view: string) => void,
): Promise<void> {
  // The end is padded by one day: `refresh_continuous_aggregate` will not
  // materialize a bucket that is not wholly inside the window, and the last
  // bucket of history ends exactly at `to`.
  const from = new Date(span.from.getTime() - 86_400_000).toISOString();
  const to = new Date(span.to.getTime() + 86_400_000).toISOString();
  for (const view of ["minute_rollups", "hourly_rollups", "daily_rollups"] as const) {
    onProgress?.(view);
    await client.query(`call refresh_continuous_aggregate($1, $2::timestamptz, $3::timestamptz)`, [
      view,
      from,
      to,
    ]);
  }
}

/**
 * Disarm and re-arm `metrics_raw`'s compression policy around the load.
 *
 * The policy compresses chunks older than two hours, and every imported chunk is
 * older than that by construction. A background job compressing a chunk the
 * import is still writing into is slow at best; once compressed, an in-place
 * `DELETE`/`UPDATE` silently aborts past ~100 k tuples, which is exactly the
 * shape a retry would need. So it is removed for the duration and added back —
 * and added back with the interval `policies.sql` declares, so a re-run of
 * `migrate` is not needed to restore it.
 */
async function withCompressionDisarmed<T>(
  client: ReplayClient,
  body: () => Promise<T>,
): Promise<T> {
  let interval: string | null = null;
  try {
    const value = await scalar(
      client,
      `select (config->>'compress_after') as i from timescaledb_information.jobs
       where proc_name = 'policy_compression' and hypertable_name = 'metrics_raw' limit 1`,
    );
    interval = value === null || value === undefined ? null : String(value);
    if (interval !== null) {
      await client.query(`select remove_compression_policy('metrics_raw', if_exists => true)`);
    }
  } catch {
    // No policy armed (a database whose policies.sql has not run). Nothing to do.
    interval = null;
  }
  try {
    return await body();
  } finally {
    if (interval !== null) {
      await client.query(
        `select add_compression_policy('metrics_raw', $1::interval, if_not_exists => true)`,
        [interval],
      );
    }
  }
}

/** Rows the target already holds in the archive's span, for its devices. */
async function overlappingRows(
  client: ReplayClient,
  manifest: ArchiveManifest,
  deviceIds: readonly number[],
): Promise<number> {
  if (manifest.span.from === null || manifest.span.to === null || deviceIds.length === 0) return 0;
  return num(
    await scalar(
      client,
      `select count(*)::bigint as n from metrics_raw
       where device_id in (${paramList(1, deviceIds.length)})
         and time >= $${deviceIds.length + 1} and time < $${deviceIds.length + 2}`,
      [...deviceIds, manifest.span.from, manifest.span.to],
    ),
  );
}

/**
 * Everything the load steps share.
 *
 * A context object rather than eight parameters threaded through five functions:
 * the steps are sequential and each one needs most of it, and the alternative was
 * one 250-line function nobody could review.
 */
interface LoadContext {
  client: ReplayClient;
  archive: OpenArchive;
  /** Archive slug (already mapped) -> `devices.id`. */
  devices: ReadonlyMap<string, number>;
  metricIds: ReadonlyMap<string, number>;
  /** Applies the caller's `deviceMap`. Identity when there is none. */
  slugFor: (slug: string) => string;
  /** Bucket tiers this archive actually carries rows for. */
  bucketTiers: readonly Exclude<SourceTier, "raw">[];
  inserted: StreamCounts;
  report: (stage: string, rows?: number) => void;
  /** Widened as rows are read — what the refresh and the marker are bounded by. */
  span: { oldest: Date | null; newest: Date | null };
}

/**
 * ONE PASS over the readings member, routed by tier.
 *
 * `raw` goes straight into `metrics_raw` (there is no bucket, no width to derive
 * and nothing to collapse — the row already carries its own `dur_ms`); a bucket
 * row is landed in its tier's staging table for the replay to read. Both are
 * buffered to {@link BATCH_ROWS}, so memory is bounded by the batch rather than
 * by the archive.
 */
/**
 * A batching writer: push rows, it inserts at {@link BATCH_ROWS}.
 *
 * Extracted because the import has THREE of these (raw, staging, config log) and
 * they were three copies of the same push/flush/reset dance inside one loop. It
 * is also the only reason memory is bounded by the batch rather than by the
 * archive, so it is worth being a named thing with its own test.
 */
export interface BatchWriter<T> {
  push(row: T): Promise<void>;
  flush(): Promise<void>;
  /** Rows handed to `insert` so far. */
  readonly written: number;
}

export function batchWriter<T>(
  insert: (rows: readonly T[]) => Promise<number>,
  size = BATCH_ROWS,
): BatchWriter<T> {
  const pending: T[] = [];
  let written = 0;
  const flush = async () => {
    // An empty flush must not run: `INSERT … VALUES ()` is a syntax error, and the
    // final flush of an empty stream is the common case (an empty archive).
    if (pending.length === 0) return;
    written += await insert(pending);
    pending.length = 0;
  };
  return {
    get written() {
      return written;
    },
    async push(row) {
      pending.push(row);
      if (pending.length >= size) await flush();
    },
    flush,
  };
}

/**
 * ONE PASS over the readings member, routed by tier.
 *
 * `raw` goes straight into `metrics_raw` (there is no bucket, no width to derive
 * and nothing to collapse — the row already carries its own `dur_ms`); a bucket
 * row is landed in its tier's staging table for the replay to read.
 */
async function loadReadings(ctx: LoadContext): Promise<void> {
  const raw = batchWriter<ReadingRow>(async (rows) => {
    const n = await insertRaw(ctx.client, rows, ctx.devices, ctx.metricIds);
    ctx.inserted.raw += n;
    ctx.report("readings", ctx.inserted.raw);
    return n;
  });
  const staging = new Map<string, BatchWriter<ReadingRow>>(
    ctx.bucketTiers.map((tier) => [
      tier,
      batchWriter<ReadingRow>(async (rows) => {
        const n = await insertStage(ctx.client, tier, rows);
        ctx.inserted[tier] += n;
        ctx.report("staging", totalReadings(ctx.inserted));
        return n;
      }),
    ]),
  );

  let lineNo = 0;
  for await (const line of ctx.archive.lines(MEMBERS.readings)) {
    lineNo += 1;
    const row = decodeReading(line, lineNo);
    if (row === null) continue;
    widenSpan(ctx.span, row.time);
    const mapped: ReadingRow = { ...row, deviceSlug: ctx.slugFor(row.deviceSlug) };
    if (mapped.sourceTier === "raw") {
      await raw.push(mapped);
      continue;
    }
    const writer = staging.get(mapped.sourceTier);
    if (writer === undefined) {
      // The manifest declared no rows for this tier, so no staging table was
      // created for it — and the readings contain one anyway. REFUSED rather than
      // dropped: the manifest is the archive's own claim about itself, so a
      // contradiction means the file is inconsistent, and a silently dropped tier
      // would be a missing month that nothing ever reported. The manifest count
      // check cannot catch this one, because a tier the manifest says is empty is
      // absent from both sides of that comparison.
      throw new Error(
        `${MEMBERS.readings}: line ${lineNo} is a ${mapped.sourceTier} reading, but ` +
          `${MEMBERS.manifest} declares 0 rows for that tier — the archive contradicts itself ` +
          `and importing it would silently drop those readings`,
      );
    }
    await writer.push(mapped);
  }
  await raw.flush();
  for (const writer of staging.values()) await writer.flush();
}

/**
 * Widen the imported span by one reading.
 *
 * The span is what the aggregate refresh and the completion marker are bounded
 * by, and it is taken from the ROWS rather than from the manifest: a manifest can
 * be wrong about its own span, and refreshing a region that holds nothing is
 * cheap while missing one leaves a chart empty.
 */
function widenSpan(span: { oldest: Date | null; newest: Date | null }, at: Date): void {
  if (span.oldest === null || at < span.oldest) span.oldest = at;
  if (span.newest === null || at > span.newest) span.newest = at;
}

/**
 * The config log, inserted directly.
 *
 * Nothing to collapse: 2.0.0 keeps configuration out of the hypertable and
 * records only CHANGES, so an archive's config-log member is already the change
 * series. A legacy export's configuration arrives in the readings instead and is
 * collapsed by `runReplay`'s config arm.
 */
async function loadConfigLog(ctx: LoadContext): Promise<void> {
  const writer = batchWriter<ConfigLogRow>(async (rows) => {
    const n = await insertConfigLog(ctx.client, rows, ctx.devices, ctx.metricIds);
    ctx.inserted.configLog += n;
    return n;
  });
  let lineNo = 0;
  for await (const line of ctx.archive.lines(MEMBERS.configLog)) {
    lineNo += 1;
    const row = decodeConfigLog(line, lineNo);
    if (row === null) continue;
    await writer.push({ ...row, deviceSlug: ctx.slugFor(row.deviceSlug) });
  }
  await writer.flush();
}

/**
 * THE REPLAY. The staged buckets become `metrics_raw` interval rows through the
 * module that already knows how — one call per device.
 *
 * The staging index is created AFTER the load and dropped with the table: the
 * replay reads one day of one source at a time, and a sequential scan of 8 M
 * staged rows per chunk would dominate the whole import.
 */
async function replayStaged(
  ctx: LoadContext,
  source: string,
  configKeys: readonly string[],
): Promise<{ replays: ReplayResult[]; problems: string[] }> {
  const replays: ReplayResult[] = [];
  const problems: string[] = [];
  if (ctx.bucketTiers.length === 0) return { replays, problems };

  await indexStaging(ctx.client, ctx.bucketTiers);
  const relations = Object.fromEntries(
    ctx.bucketTiers.map((tier) => [tier, STAGE_TABLE[tier]]),
  ) as Record<string, string>;
  for (const [slug, deviceId] of ctx.devices) {
    ctx.report("replay");
    const result = await runReplay(ctx.client, {
      source,
      relations,
      columns: stageColumns(),
      identity: { sourceId: slug, deviceId },
      configKeys,
    });
    replays.push(result);
    for (const gap of result.gaps) {
      problems.push(
        `no tier covered ${gap.start.toISOString()}..${gap.end.toISOString()} for device ` +
          `${slug} — those days are not in the archive`,
      );
    }
  }
  await dropStaging(ctx.client, ctx.bucketTiers);
  return { replays, problems };
}

/**
 * THE COMPLETION MARKER, written only once every arm has finished.
 *
 * One row per device — see {@link doneSourceId} for why completion is recorded
 * explicitly instead of being inferred from the bucket arm's per-chunk
 * watermarks.
 */
async function writeCompletionMarkers(
  ctx: LoadContext,
  source: string,
  elapsedMs: number,
): Promise<void> {
  const { oldest, newest } = ctx.span;
  if (oldest === null || newest === null) return;
  for (const deviceId of ctx.devices.values()) {
    await ctx.client.query(
      `insert into replay_progress
         (source, device_id, chunk_start, chunk_end, tier, series_rows, config_rows, elapsed_ms)
       values ($1, $2, $3, $4, 'archive', $5, $6, $7)
       on conflict do nothing`,
      [
        doneSourceId(source),
        deviceId,
        oldest.toISOString(),
        new Date(newest.getTime() + 1).toISOString(),
        totalReadings(ctx.inserted),
        ctx.inserted.configLog,
        elapsedMs,
      ],
    );
  }
}

/** What the identity/overlap checks resolved, before a single row is written. */
interface Preflight {
  devices: Map<string, number>;
  metricIds: Map<string, number>;
  source: string;
  verdict: OverlapVerdict;
}

/**
 * Resolve identity and decide whether to import at all — BEFORE any insert.
 *
 * A `join metric_keys` that finds no match drops the row and reports success, so
 * every unknown slug and key is reported here, all at once, and the import
 * refuses. `replay-run.ts`'s `unregisteredMetrics` makes the same refusal for the
 * same reason.
 */
async function preflight(
  client: ReplayClient,
  request: ImportRequest,
  manifest: ArchiveManifest,
): Promise<Preflight> {
  const mapped = manifest.devices.map((slug) => request.deviceMap?.[slug] ?? slug);
  const devices = await resolveDevices(client, mapped);
  const metricIds = new Map<string, number>();
  if (manifest.metrics.length > 0) {
    const rows = (
      await client.query(
        `select key, id from metric_keys where key in (${paramList(1, manifest.metrics.length)})`,
        [...manifest.metrics],
      )
    ).rows as { key: string; id: unknown }[];
    for (const row of rows) metricIds.set(row.key, num(row.id));
  }

  const unknown = unknownIdentities(
    { devices: mapped, metrics: manifest.metrics },
    { devices: new Set(devices.keys()), metrics: await knownMetricKeys(client) },
  );
  if (unknown.length > 0) {
    throw new Error(
      `archive: refusing to import — ${unknown.length} identity/identities in the archive do ` +
        `not exist in the target, and a join that found no match would drop their history ` +
        `silently:\n  - ${unknown.join("\n  - ")}\n` +
        `Apply the archive's config.json first (it carries the plant graph and the metric ` +
        `vocabulary), or pass a device mapping.`,
    );
  }

  const source = archiveSourceId(manifest);
  const deviceIds = [...devices.values()];
  const countProgress = async (progressSource: string) =>
    deviceIds.length === 0
      ? 0
      : num(
          await scalar(
            client,
            `select count(*)::bigint as n from replay_progress
             where source = $1 and device_id in (${paramList(2, deviceIds.length)})`,
            [progressSource, ...deviceIds],
          ),
        );

  return {
    devices,
    metricIds,
    source,
    verdict: overlapVerdict({
      overlappingRows: await overlappingRows(client, manifest, deviceIds),
      completedDevices: await countProgress(doneSourceId(source)),
      expectedDevices: deviceIds.length,
      partialChunks: await countProgress(source),
      force: request.force === true,
    }),
  };
}

/**
 * The manifest's own claim against what was actually read.
 *
 * A mismatch means the readings member was SHORT — a truncation the tar
 * checksums could not see, or a row the decoder refused — and either way the
 * operator must hear about it rather than discovering a chart is missing a week.
 */
export function shortfallProblems(manifest: ArchiveManifest, inserted: StreamCounts): string[] {
  const claimed = totalReadings(manifest.streams);
  const written = totalReadings(inserted);
  if (claimed === written) return [];
  return [
    `manifest claims ${claimed} reading(s) but ${written} were read from the file — the ` +
      `archive is short or a row was refused`,
  ];
}

/**
 * Import `request.file` into `client`'s database.
 *
 * Every step's reasoning is in the module header; this is the sequencing, and the
 * sequencing is the part that matters.
 */
export async function importArchive(
  client: ReplayClient,
  request: ImportRequest,
): Promise<ImportResult> {
  const began = Date.now();
  const problems: string[] = [];
  const inserted = emptyStreamCounts();
  const archive = await openArchive(request.file, request.workDir);
  const report = (stage: string, rows = 0) => request.onProgress?.({ stage, rows });

  try {
    const manifest = archive.manifest;
    const config = parseArchiveConfig(archive.config);
    problems.push(...config.problems);

    // CONFIG FIRST, so the dimension spine every reading resolves against exists.
    if (request.applyConfig !== false) {
      report("config");
      if (config.plant !== null) await applyPlant(client, config.plant);
      await applyConfigRows(client, config);
    }

    const { devices, metricIds, source, verdict } = await preflight(client, request, manifest);
    if (verdict.action === "refuse") throw new Error(`archive: ${verdict.reason}`);
    if (verdict.action === "skip") {
      return {
        manifest,
        inserted,
        replays: [],
        problems,
        skipped: verdict.reason,
        elapsedMs: Date.now() - began,
      };
    }
    if (verdict.reason) problems.push(verdict.reason);

    const bucketTiers = (["minute", "hourly", "daily"] as const).filter(
      (tier) => manifest.streams[tier] > 0,
    );
    await createStaging(client, bucketTiers);

    const ctx: LoadContext = {
      client,
      archive,
      devices,
      metricIds,
      slugFor: (slug) => request.deviceMap?.[slug] ?? slug,
      bucketTiers,
      inserted,
      report,
      span: { oldest: null, newest: null },
    };

    // ONE disarm around the WHOLE load, not one per batch: arming and disarming a
    // policy per batch would be hundreds of catalogue writes and would leave a
    // window between them in which a compression job could fire.
    const replayed = await withCompressionDisarmed(client, async () => {
      await loadReadings(ctx);
      await loadConfigLog(ctx);
      return replayStaged(ctx, source, config.configKeys);
    });
    problems.push(...replayed.problems);

    // Manual refresh over the WHOLE span. The policies reach three hours back;
    // imported history never is, so without this the aggregates stay empty while
    // the hypertable is full.
    if (request.refresh !== false && ctx.span.oldest !== null && ctx.span.newest !== null) {
      report("refresh");
      await refreshAggregates(client, { from: ctx.span.oldest, to: ctx.span.newest }, (view) =>
        report(view),
      );
    }

    await writeCompletionMarkers(ctx, source, Date.now() - began);

    problems.push(
      ...[
        retentionWarning({
          oldest: ctx.span.oldest,
          rawRetentionDays: await rawRetentionDays(client),
          now: new Date(),
        }),
      ].filter((warning): warning is string => warning !== null),
    );

    problems.push(...shortfallProblems(manifest, inserted));

    return {
      manifest,
      inserted,
      replays: replayed.replays,
      problems,
      skipped: null,
      elapsedMs: Date.now() - began,
    };
  } finally {
    await archive.close();
  }
}

/**
 * Where a caller should put the scratch directory.
 *
 * Beside the archive rather than in the system temp dir: the decompressed tar is
 * the size of the history, and `/tmp` is a tmpfs on a Home Assistant box — a full
 * import would fill RAM through the back door.
 */
export const defaultWorkDir = (file: string): string => `${file}.work`;
