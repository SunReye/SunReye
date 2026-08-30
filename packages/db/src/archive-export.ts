/**
 * THE EXPORTER: a SunReye database out to a portable `.tar.gz`, in constant
 * memory, from EITHER schema.
 *
 * Read `./archive.ts` (the format), `./archive-config.ts` (the graph) and
 * `./archive-file.ts` (the container) first. This file is only the reading.
 *
 * ## Two sources, one format
 *
 * `native` reads 2.0.0: `metrics_raw` joined to the dimension spine, plus
 * `metrics_config_log`, plus whichever aggregate tiers the caller asks for (a
 * frozen minute tier is history nothing else holds).
 *
 * `legacy` reads 1.2.0 — `metrics_raw(time, inverter_id, metric, value)` and the
 * unweighted `minute/hourly/daily_rollups`. That arm is not a nicety: it is the
 * ESCAPE HATCH if the in-place upgrade fails, which is why the same binary
 * carries it and why it reads the legacy objects the migration deliberately
 * preserves until verification passes.
 *
 * ## One tier per day, and why that is the whole correctness story
 *
 * A given (device, metric, instant) must appear EXACTLY ONCE in the file. An
 * hourly bucket and the sixty minute buckets inside it are the same energy
 * counted twice, and a double count is the one error an export must never make.
 *
 * So coverage is planned per UTC day and the FINEST available source wins, which
 * is exactly what `./replay.ts`'s `planReplay` already decides for the in-place
 * upgrade. It is called here rather than reimplemented; {@link planExport} only
 * adds `raw` on top, because raw is finer than every bucket and `planReplay`'s
 * tier list deliberately does not know about it.
 *
 * On the real 1.2.0 fixture that plan is not academic: raw retention is 7 days
 * and the minute tier reaches 90, so the plan is `minute` for the first ~53 days
 * and `raw` for the last 7 — the PARTIAL-COVERAGE UNION the `source_tier` field
 * exists to express.
 *
 * ## Why the rows are read per (device, metric, window)
 *
 * The alternative is one query per day, and a day of 1 Hz raw across ~105
 * metrics is ~9 M rows — a result set that cannot be held. Per (device, metric)
 * the read is an exact index range scan on
 * `metrics_raw_device_metric_time_idx` / the aggregates' own ordering, and the
 * window is sized per tier so a batch is ~100k rows whatever the cadence. Memory
 * is therefore bounded by the batch, not by the export.
 */

import { type LineSpool, createLineSpool, writeArchive } from "./archive-file";
import {
  type ArchiveConfig,
  type ArchivePlant,
  emptyArchiveConfig,
  redactSecrets,
  synthesiseSpine,
  unwrapSetting,
} from "./archive-config";
import {
  type ArchiveManifest,
  MEMBERS,
  type SourceFingerprint,
  type SourceTier,
  type StreamCounts,
  buildManifest,
  emptyStreamCounts,
  encodeConfigLog,
  encodeReading,
} from "./archive";
import { type Span, type TierWindow, bucketWidthMs, planReplay } from "./replay";
import type { ReplayClient } from "./replay-run";

/** Milliseconds in a UTC day, as everywhere else in the replay. */
const DAY_MS = 86_400_000;

export type ExportSourceKind = "native" | "legacy";

/**
 * A source's coverage of one tier, `raw` included — the same shape
 * `./replay.ts` plans over, widened by one pseudo-tier.
 */
export interface SourceWindow {
  tier: SourceTier;
  from: Date;
  /** Exclusive. For a bucket tier this is the last bucket START PLUS ITS WIDTH. */
  to: Date;
}

/** One unit of export work: a span and the single source that answers it. */
export interface ExportChunk extends Span {
  tier: SourceTier;
}

export interface ExportPlan {
  chunks: ExportChunk[];
  /** Days no source could answer. Reported in the result, never silent. */
  gaps: Span[];
}

/**
 * A chunk the plan assigned to a tier that then produced NOTHING.
 *
 * Its own finding, separate from a `gap`, because the two have different causes
 * and only one of them is expected. A gap is "no tier holds this day"; a barren
 * chunk is "a tier claimed this day and had nothing to give", which means either
 * the day is genuinely empty or the projection for that tier returns NULL — the
 * shape of the bug that lost a whole day of a 2.0.0 export (see
 * {@link planExport}). Reported, never silent.
 */
export interface BarrenChunk extends ExportChunk {
  reason: string;
}

/**
 * Split `[from, to)` into UTC days and give each day its FINEST source.
 *
 * `raw` is checked first and separately because `planReplay`'s tier order
 * (`minute`, `hourly`, `daily`) deliberately knows nothing about it — the
 * in-place upgrade replays what raw retention has already dropped, so raw is
 * never a candidate there. Here it is, and it is the finest one there is.
 *
 * A day is never split between sources, for the same reason `planReplay` never
 * splits a chunk: mixing an hourly interval with the minute intervals inside it
 * is a double count.
 */
export function planExport(
  windows: readonly SourceWindow[],
  span: { from: Date; to: Date },
): ExportPlan {
  const raw = windows.find((w) => w.tier === "raw");
  const buckets = windows.filter((w) => w.tier !== "raw") as TierWindow[];

  /**
   * Whether `raw` answers this day — and the two halves are NOT symmetric.
   *
   * `from <= day.start` is required, because raw that STARTS mid-day holds only
   * part of it. That is the oldest-raw-day case: 1.2.0 trims raw to seven days
   * while its minute tier reaches ninety, so on the boundary day raw has the
   * afternoon and the minute tier has the whole day. Preferring raw there would
   * silently lose the morning.
   *
   * But only `to > day.start` is required at the other end, NOT `to >= day.end`,
   * and that asymmetry is the whole fix. Raw's window ends at its LAST ROW, so
   * the newest day is always "partially covered" — it is partial because reality
   * is, not because anything is missing. Requiring coverage to midnight handed
   * that day to the minute tier instead, and on a 2.0.0 database whose minute
   * buckets each hold a single sample `average(tw)` is NULL for every one of them
   * (a point has no duration), so every row was dropped and a whole day vanished
   * from the export with nothing reported. Measured: 8,920,800 rows against
   * 9,072,000.
   *
   * It is also sound rather than merely convenient: every bucket tier is DERIVED
   * from raw, so where raw reaches, no coarser tier can add information.
   */
  const rawCovers = (day: Span) =>
    raw !== undefined &&
    raw.from.getTime() <= day.start.getTime() &&
    raw.to.getTime() > day.start.getTime();

  const chunks: ExportChunk[] = [];
  const gaps: Span[] = [];
  let cursor = span.from.getTime();
  const end = span.to.getTime();
  while (cursor < end) {
    const dayEnd = Math.floor(cursor / DAY_MS) * DAY_MS + DAY_MS;
    const day: Span = { start: new Date(cursor), end: new Date(Math.min(dayEnd, end)) };
    if (rawCovers(day)) {
      chunks.push({ tier: "raw", ...day });
    } else {
      // Delegated: the finest-covering rule for the bucket tiers is `planReplay`'s,
      // and having one implementation of it is the point.
      const planned = planReplay({ from: day.start, to: day.end, windows: buckets });
      chunks.push(...planned.chunks.map((chunk) => ({ ...chunk }) as ExportChunk));
      gaps.push(...planned.gaps);
    }
    cursor = dayEnd;
  }
  return { chunks, gaps };
}

/**
 * How many days one query covers, per tier.
 *
 * Sized so a batch is on the order of 100k rows for ONE metric on ONE device,
 * whatever the cadence: raw at 1 Hz is 86 400 rows/day, a minute tier 1 440, an
 * hourly 24, a daily 1. Bigger windows mean fewer round trips; the ceiling is
 * how much this process is willing to hold at once.
 */
export const WINDOW_DAYS: Record<SourceTier, number> = {
  raw: 1,
  minute: 30,
  hourly: 365,
  daily: 3650,
};

/** UTC-day-aligned sub-windows of a chunk, at most `days` long each. */
export function windowsOf(chunk: Span, days: number): Span[] {
  const out: Span[] = [];
  const step = days * DAY_MS;
  let cursor = chunk.start.getTime();
  const end = chunk.end.getTime();
  while (cursor < end) {
    const next = Math.min(cursor + step, end);
    out.push({ start: new Date(cursor), end: new Date(next) });
    cursor = next;
  }
  return out;
}

/**
 * A "has this changed" filter over a stream ordered by (device, metric, time).
 *
 * The whole of the config-log collapse for the legacy raw arm: 1.2.0 wrote
 * configuration registers into `metrics_raw` at the poll cadence, so a week of
 * them is ~265 k rows saying the same thing. Only CHANGES are information, which
 * is what 2.0.0's writer records and what issue #150 asks for.
 *
 * Deliberately NOT a reimplementation of `./replay-run.ts`'s config arm: there is
 * no bucket, no width and no `lag()` window here — it is "skip if equal to the
 * last value seen for this series", and it is correct only because the reader
 * emits each series in time order, which the per-(device, metric, window) read
 * guarantees.
 */
export function createChangeFilter(): (series: string, value: number) => boolean {
  const last = new Map<string, number>();
  return (series, value) => {
    // `has` + `!==`, not a falsy check: 0 is a legitimate setting value and the
    // most common one (a disabled limit).
    if (last.has(series) && last.get(series) === value) return false;
    last.set(series, value);
    return true;
  };
}

export interface ExportRequest {
  source: ExportSourceKind;
  /** Where the finished `.tar.gz` goes. */
  out: string;
  /** Scratch directory for the spools. Removed by the caller, not here. */
  workDir: string;
  /**
   * Which sources to consider, finest first. Defaults to everything the schema
   * has. Narrowing it is how an operator exports "aggregates only".
   */
  tiers?: readonly SourceTier[];
  /** `legacy` only: the profile id, when it is not in `app_settings`. */
  profileId?: string | null;
  /**
   * The metric vocabulary WITH its counter class.
   *
   * REQUIRED for a `legacy` export and refused if absent, because 1.2.0 has no
   * `metric_keys` table to read it from and defaulting `is_counter` to false
   * would make every energy total on the other side a naive max-minus-min. On the
   * real fixture that is 64280.971 kWh against a truth of 41.971 — wrong by
   * 1532x, silently. The caller resolves it from the profile (`statedKind`).
   */
  metricKeys?: readonly { key: string; isCounter: boolean }[];
  /** Keys the profile stores as configuration. Never a prefix match. */
  configKeys?: readonly string[];
  /**
   * Carry per-instance SECRETS (the MQTT password, a provider token) in
   * `config.json`.
   *
   * OFF by default, and the default is the point. `app_settings` holds those in
   * plaintext, the REST API deliberately refuses to return them
   * (`maskMqttConfig`), and on the Home Assistant add-on the export lands in
   * `/share` — which the Samba add-on serves to the whole LAN. So an export is
   * safe to hand around by default, and retyping an MQTT password is the same
   * 30-second trade already accepted for the admin account.
   *
   * Turn it on when MOVING MACHINES and treat the file accordingly.
   */
  includeSecrets?: boolean;
  /** Stamped into the manifest as provenance. */
  appVersion?: string;
  onProgress?: (progress: { tier: SourceTier; window: Span; rows: number; total: number }) => void;
}

export interface ExportResult {
  path: string;
  /** Chunks that were planned but yielded no rows. See {@link BarrenChunk}. */
  barren: BarrenChunk[];
  /** Size of the finished archive. */
  bytes: number;
  /** NDJSON bytes before compression, for the ratio the operator wants. */
  uncompressedBytes: number;
  manifest: ArchiveManifest;
  plan: ExportPlan;
  elapsedMs: number;
}

const num = (value: unknown): number => Number(value ?? 0);

const asDate = (value: unknown): Date | null => {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
};

/**
 * The relation each tier lives in. Identical between the two sources by
 * coincidence of naming, and spelled out per source anyway so a future rename on
 * one side cannot silently redirect the other.
 */
const RELATION: Record<ExportSourceKind, Record<SourceTier, string>> = {
  native: {
    raw: "metrics_raw",
    minute: "minute_rollups",
    hourly: "hourly_rollups",
    daily: "daily_rollups",
  },
  legacy: {
    raw: "metrics_raw",
    minute: "minute_rollups",
    hourly: "hourly_rollups",
    daily: "daily_rollups",
  },
};

/**
 * The projection each (source, tier) reads: the time column, the value, and the
 * duration the value stands for.
 *
 * The 2.0.0 aggregates hold `time_weight` PARTIALS rather than a finished mean,
 * so a native bucket's value is `average(tw)` — which is NULL for a bucket
 * holding a single sample (a point has no duration), and those rows are skipped
 * rather than fabricated as zero. The 1.2.0 aggregates hold an unweighted
 * `avg_value`, which for 1.2.0 DATA *is* the time-weighted mean because the
 * writer stored every sample at a fixed cadence — the reasoning is
 * `./replay.ts`'s and is not re-derived here.
 */
function projection(
  source: ExportSourceKind,
  tier: SourceTier,
): { time: string; value: string; durMs: string } {
  if (tier === "raw") {
    return {
      time: "r.time",
      value: "r.value",
      // 1.2.0's metrics_raw is (time, inverter_id, metric, value) — there is no
      // dur_ms column at all, and NULL is the honest answer for "unknown hold",
      // which is not the same as zero.
      durMs: source === "legacy" ? "null::integer" : "r.dur_ms",
    };
  }
  const width = bucketWidthMs(tier);
  return {
    time: "r.bucket",
    value: source === "legacy" ? "r.avg_value" : "average(r.tw)",
    durMs: `${width}::integer`,
  };
}

/** How a source names a device and a metric on a reading row. */
function identity(source: ExportSourceKind): { join: string; device: string; metric: string } {
  return source === "legacy"
    ? { join: "", device: "r.inverter_id", metric: "r.metric" }
    : {
        join: "join devices d on d.id = r.device_id join metric_keys mk on mk.id = r.metric_id",
        device: "d.slug",
        metric: "mk.key",
      };
}

/** `min`/`max` of a tier's time column, i.e. what retention has left. */
async function readWindow(
  client: ReplayClient,
  source: ExportSourceKind,
  tier: SourceTier,
): Promise<SourceWindow | null> {
  const relation = RELATION[source][tier];
  const column = tier === "raw" ? "time" : "bucket";
  let rows: unknown[];
  try {
    const result = await client.query(
      `select min(${column}) as "from", max(${column}) as "to" from ${relation}`,
    );
    rows = result.rows;
  } catch {
    // A tier the source schema does not have at all (a 2.0.0 database whose
    // minute tier was dropped, a 1.x one predating a rollup). Absent, not empty.
    return null;
  }
  const row = rows[0] as { from: unknown; to: unknown } | undefined;
  const from = asDate(row?.from);
  const to = asDate(row?.to);
  if (from === null || to === null) return null;
  return {
    tier,
    from,
    // EXCLUSIVE, and both arms of this earn their keep.
    //
    // A bucket stamped 23:00 covers up to 00:00, so a bucket tier's end is the
    // last bucket's START PLUS ITS WIDTH; treating `max(bucket)` as the end would
    // leave the final bucket of history outside every plan, forever.
    //
    // A RAW row is an instant, not a span, but the window is still half-open and
    // every read below is `>= start and < end` — so `max(time)` as the end drops
    // THE LAST ROW OF EVERY SERIES, silently. Caught by
    // `apps/server/db-tests/archive.test.ts` counting 17 277 rows against a
    // seeded 17 280; it had escaped the full-fixture round trip only because the
    // plan happened to give that day to the minute tier instead.
    to: new Date(to.getTime() + (tier === "raw" ? 1 : bucketWidthMs(tier))),
  };
}

/** The (device, metric) pairs a source holds, so the read can be per series. */
async function readSeries(
  client: ReplayClient,
  source: ExportSourceKind,
  tier: SourceTier,
): Promise<{ device: string; metric: string }[]> {
  const relation = RELATION[source][tier];
  const { join, device, metric } = identity(source);
  const result = await client.query(
    `select distinct ${device} as device, ${metric} as metric from ${relation} r ${join}
     order by 1, 2`,
  );
  return (result.rows as { device: string; metric: string }[]).map((row) => ({
    device: String(row.device),
    metric: String(row.metric),
  }));
}

const DEFAULT_TIERS: Record<ExportSourceKind, readonly SourceTier[]> = {
  // Finest first. All four are considered; `planExport` decides which answers a
  // given day, so listing one the database does not hold costs nothing.
  native: ["raw", "minute", "hourly", "daily"],
  legacy: ["raw", "minute", "hourly", "daily"],
};

/**
 * The schema the export came out of, as evidence rather than as a claim.
 *
 * Read from the database, not from the build: a binary can be newer than the
 * database it is pointed at, and the whole value of the fingerprint is telling a
 * human what actually wrote the file.
 */
async function fingerprint(
  client: ReplayClient,
  source: ExportSourceKind,
  appVersion: string | undefined,
): Promise<SourceFingerprint> {
  const timescaleFiles: string[] = [];
  try {
    const result = await client.query("select name from timescale_migrations order by name");
    for (const row of result.rows as { name: string }[]) timescaleFiles.push(row.name);
  } catch {
    // A database that never ran the journaled pipeline. Absent, not zero.
  }
  let drizzleTag: string | null = null;
  let drizzleWhen: number | null = null;
  try {
    const result = await client.query(
      `select hash, created_at from drizzle.__drizzle_migrations order by created_at desc limit 1`,
    );
    const row = result.rows[0] as { hash: string; created_at: unknown } | undefined;
    if (row) {
      drizzleTag = row.hash;
      drizzleWhen = Number(row.created_at ?? 0) || null;
    }
  } catch {
    // Pre-journal (`db:push` era) — exactly what a 1.2.0 database is.
  }
  return {
    app: appVersion ?? (source === "legacy" ? "1.2.0-legacy" : "unknown"),
    drizzleTag,
    drizzleWhen,
    timescaleFiles,
  };
}

/** `app_settings` as a map. Values stay verbatim; unwrapping is for reading. */
async function readSettings(client: ReplayClient): Promise<Map<string, unknown>> {
  const settings = new Map<string, unknown>();
  try {
    const result = await client.query("select key, value from app_settings order by key");
    for (const row of result.rows as { key: string; value: unknown }[]) {
      settings.set(row.key, row.value);
    }
  } catch {
    // No settings table: an empty database, which must still export.
  }
  return settings;
}

async function rowsOf(client: ReplayClient, query: string): Promise<Record<string, unknown>[]> {
  try {
    const result = await client.query(query);
    return result.rows as Record<string, unknown>[];
  } catch {
    return [];
  }
}

/** The 2.0.0 plant graph, by name. Null when there is no plant row. */
async function readNativePlant(client: ReplayClient): Promise<ArchivePlant | null> {
  const plants = await rowsOf(
    client,
    `select id, name, slug, time_zone, latitude, longitude, label, arrays, temp_coefficient,
            system_loss, max_output_w, house_load_w, smart_meter_since, bidding_zone, tariff_key
     from plants order by id limit 1`,
  );
  const plant = plants[0];
  if (!plant) return null;
  const plantId = Number(plant.id);
  const connections = await rowsOf(
    client,
    `select id, name, host, port, transport, timeout_ms, poll_interval_ms
     from connections where plant_id = ${plantId} order by id`,
  );
  const byId = new Map(connections.map((c) => [String(c.id), String(c.name)]));
  const devices = await rowsOf(
    client,
    `select d.slug, d.name, d.profile_id, d.serial, d.role, d.unit_id, d.connection_id,
            d.retired_at,
            b.usable_kwh, b.max_charge_w, b.min_soc, b.nominal_v
     from devices d left join batteries b on b.device_id = d.id
     where d.plant_id = ${plantId} order by d.id`,
  );
  const optional = (value: unknown) =>
    value === null || value === undefined ? null : Number(value);
  const optionalText = (value: unknown) =>
    value === null || value === undefined ? null : String(value);
  // Explicitly ISO, not `String(value)`: this driver hands a timestamptz back as
  // a Date, and `String(new Date())` is "Wed Mar 04 2026 …" — a string the
  // importer's `Date` parse would accept in some locales and mangle in others.
  // The archive is JSON, so the wire form has to be stated, not inherited.
  const optionalInstant = (value: unknown) => {
    if (value === null || value === undefined) return null;
    const at = value instanceof Date ? value : new Date(String(value));
    return Number.isNaN(at.getTime()) ? null : at.toISOString();
  };
  return {
    name: String(plant.name),
    slug: String(plant.slug),
    timeZone: String(plant.time_zone ?? "auto"),
    latitude: optional(plant.latitude),
    longitude: optional(plant.longitude),
    label: String(plant.label ?? ""),
    arrays: plant.arrays ?? [],
    tempCoefficient: optional(plant.temp_coefficient),
    systemLoss: optional(plant.system_loss),
    maxOutputW: optional(plant.max_output_w),
    houseLoadW: optional(plant.house_load_w),
    smartMeterSince: optionalText(plant.smart_meter_since),
    biddingZone: optionalText(plant.bidding_zone),
    tariffKey: optionalText(plant.tariff_key),
    connections: connections.map((c) => ({
      name: String(c.name),
      host: String(c.host),
      port: Number(c.port),
      transport: String(c.transport),
      timeoutMs: Number(c.timeout_ms),
      pollIntervalMs: Number(c.poll_interval_ms),
    })),
    devices: devices.map((d) => ({
      slug: String(d.slug),
      name: String(d.name),
      profileId: String(d.profile_id),
      serial: optionalText(d.serial),
      role: String(d.role),
      unitId: Number(d.unit_id),
      connection: d.connection_id === null ? null : (byId.get(String(d.connection_id)) ?? null),
      retiredAt: optionalInstant(d.retired_at),
      battery:
        d.usable_kwh === null || d.usable_kwh === undefined
          ? null
          : {
              usableKwh: Number(d.usable_kwh),
              maxChargeW: optional(d.max_charge_w),
              minSoc: Number(d.min_soc),
              nominalV: optional(d.nominal_v),
            },
    })),
  };
}

/**
 * A setting/profile/chart value as the archive should carry it.
 *
 * NORMALISED on the legacy path, verbatim on the native one. Real 1.x databases
 * store `app_settings.value`, `installed_profiles.data` and `custom_charts.data`
 * as a jsonb STRING containing the document rather than as the document — the
 * committed addon-1.2.0 fixture is one, every row of it. Carrying that forward
 * would produce an archive whose settings and profile are unreadable to 2.0.0's
 * own parsers.
 *
 * The native path never unwraps: a 2.0.0 setting whose real value IS a string
 * must stay that string.
 */
const canonicaliser = (request: ExportRequest): ((value: unknown) => unknown) => {
  const unwrap = request.source === "legacy" ? unwrapSetting : (value: unknown) => value;
  // Redaction is applied AFTER unwrapping, and it has to be: a 1.x setting is a
  // JSON string, so redacting first would walk a string and find no fields at all
  // — the password would travel, quietly, on exactly the legacy path this feature
  // exists for.
  return request.includeSecrets === true ? unwrap : (value) => redactSecrets(unwrap(value));
};

/** Settings, profiles and charts — the part both sources carry identically. */
async function readSharedConfig(
  client: ReplayClient,
  request: ExportRequest,
  settings: Map<string, unknown>,
): Promise<ArchiveConfig> {
  const config = emptyArchiveConfig();
  const canonical = canonicaliser(request);
  config.appSettings = [...settings.entries()].map(([key, value]) => ({
    key,
    value: canonical(value),
  }));
  config.installedProfiles = (
    await rowsOf(client, "select id, source, version, data from installed_profiles order by id")
  ).map((row) => ({
    id: String(row.id),
    source: String(row.source),
    version: String(row.version),
    data: canonical(row.data) ?? {},
  }));
  config.customCharts = (
    await rowsOf(client, "select id, name, data from custom_charts order by id")
  ).map((row) => ({
    id: String(row.id),
    name: String(row.name),
    data: canonical(row.data) ?? {},
  }));
  config.configKeys = [...(request.configKeys ?? [])];
  return config;
}

/** The 2.0.0 arm: a real plant graph and a real `metric_keys` table to read. */
async function readNativeConfig(
  client: ReplayClient,
  request: ExportRequest,
  config: ArchiveConfig,
): Promise<void> {
  config.plant = await readNativePlant(client);
  config.metricKeys = request.metricKeys
    ? [...request.metricKeys]
    : (await rowsOf(client, "select key, is_counter from metric_keys order by key")).map((row) => ({
        key: String(row.key),
        isCounter: row.is_counter === true,
      }));
}

/**
 * The 1.x arm: no plant, no devices, no `metric_keys`.
 *
 * The vocabulary is therefore REQUIRED from the caller and refused if absent —
 * see {@link ExportRequest.metricKeys} for what defaulting it costs.
 */
function readLegacyConfig(
  request: ExportRequest,
  settings: Map<string, unknown>,
  config: ArchiveConfig,
): void {
  if (!request.metricKeys || request.metricKeys.length === 0) {
    throw new Error(
      "archive: a legacy (1.x) export needs the metric vocabulary with its counter class — " +
        "1.2.0 has no metric_keys table, and defaulting is_counter to false would turn every " +
        "energy total on the other side into a naive max-minus-min (measured on the real " +
        "fixture: 64280.971 kWh against a truth of 41.971 for total_energy on 2026-07-28). " +
        "Pass metricKeys, resolved from the active profile.",
    );
  }
  config.metricKeys = [...request.metricKeys];
  const fromSettings = unwrapSetting(settings.get("inverter.profile"));
  const profileId =
    request.profileId ??
    (typeof fromSettings === "string" ? fromSettings : null) ??
    config.installedProfiles[0]?.id ??
    null;
  config.plant = synthesiseSpine({ settings, profileId, legacy: true });
}

/** Everything `config.json` carries. Auth tables are deliberately absent. */
async function readConfig(
  client: ReplayClient,
  request: ExportRequest,
  settings: Map<string, unknown>,
): Promise<ArchiveConfig> {
  const config = await readSharedConfig(client, request, settings);
  if (request.source === "native") await readNativeConfig(client, request, config);
  else readLegacyConfig(request, settings, config);
  return config;
}

/** The coverage each configured tier still has, skipping the ones it has none. */
async function readSourceWindows(
  client: ReplayClient,
  source: ExportSourceKind,
  tiers: readonly SourceTier[],
): Promise<SourceWindow[]> {
  const windows: SourceWindow[] = [];
  for (const tier of tiers) {
    const window = await readWindow(client, source, tier);
    if (window !== null) windows.push(window);
  }
  return windows;
}

/** The plan over everything the source holds, or an empty one when it holds nothing. */
function planFor(windows: readonly SourceWindow[]): ExportPlan {
  if (windows.length === 0) return { chunks: [], gaps: [] };
  return planExport(windows, {
    from: new Date(Math.min(...windows.map((w) => w.from.getTime()))),
    to: new Date(Math.max(...windows.map((w) => w.to.getTime()))),
  });
}

/** The two spools an export writes, and the counters that describe them. */
interface ExportSink {
  readings: LineSpool;
  configLog: LineSpool;
  streams: StreamCounts;
  devices: Set<string>;
  metrics: Set<string>;
  /** NDJSON bytes before compression — mutable, hence a field rather than a local. */
  uncompressedBytes: number;
  /** Only the legacy raw arm collapses anything. See {@link createChangeFilter}. */
  changed: (series: string, value: number) => boolean;
}

function write(sink: ExportSink, spool: LineSpool, line: string): void {
  sink.uncompressedBytes += line.length + 1;
  spool.write(line);
}

/**
 * One (device, metric) series over one window: the rows, routed.
 *
 * Returns how many READING rows it wrote, which is what the progress callback
 * reports — config changes are not readings.
 */
/** One source row as the export reads it, before any decision is made about it. */
interface SourceRow {
  t: unknown;
  v: unknown;
  d: unknown;
}

/**
 * Write one row, or decide it is not a reading at all.
 *
 * Returns true when a READING was written — config changes are not readings, and
 * neither is a row that carried no value.
 */
function readingOf(row: SourceRow): { at: Date; value: number } | null {
  const at = asDate(row.t);
  // A NULL mean is DROPPED, never read as 0: a 2.0.0 bucket holding a single
  // sample has no time-weighted average (a point has no duration), and a zero
  // there would be a fabricated reading. A mean OF zero is kept, and so is a
  // negative one — export power and battery discharge are signed. See
  // `./replay.ts`.
  if (at === null || row.v === null || row.v === undefined) return null;
  const value = Number(row.v);
  return Number.isFinite(value) ? { at, value } : null;
}

function writeRow(
  sink: ExportSink,
  chunk: ExportChunk,
  series: { device: string; metric: string },
  row: SourceRow,
  isConfig: boolean,
): boolean {
  const parsed = readingOf(row);
  if (parsed === null) return false;
  const { at, value: reading } = parsed;
  sink.devices.add(series.device);
  sink.metrics.add(series.metric);

  if (isConfig && chunk.tier === "raw") {
    if (!sink.changed(`${series.device} ${series.metric}`, reading)) return false;
    write(
      sink,
      sink.configLog,
      encodeConfigLog({
        time: at,
        deviceSlug: series.device,
        metricKey: series.metric,
        value: reading,
      }),
    );
    sink.streams.configLog += 1;
    return false;
  }

  write(
    sink,
    sink.readings,
    encodeReading({
      time: at,
      deviceSlug: series.device,
      metricKey: series.metric,
      value: reading,
      durMs: row.d === null || row.d === undefined ? null : num(row.d),
      sourceTier: chunk.tier,
    }),
  );
  sink.streams[chunk.tier] += 1;
  return true;
}

/**
 * One (device, metric) series over one window: the rows, routed.
 *
 * Returns how many READING rows it wrote, which is what the progress callback
 * reports.
 */
async function writeSeries(
  client: ReplayClient,
  request: ExportRequest,
  chunk: ExportChunk,
  window: Span,
  series: { device: string; metric: string },
  sink: ExportSink,
  isConfig: boolean,
): Promise<number> {
  const { time, value, durMs } = projection(request.source, chunk.tier);
  const { join, device: deviceExpr, metric: metricExpr } = identity(request.source);
  const relation = RELATION[request.source][chunk.tier];
  const timeColumn = chunk.tier === "raw" ? "time" : "bucket";
  const result = await client.query(
    `select ${time} as t, ${value} as v, ${durMs} as d
     from ${relation} r ${join}
     where ${deviceExpr} = $1 and ${metricExpr} = $2
       and r.${timeColumn} >= $3 and r.${timeColumn} < $4
     order by r.${timeColumn}`,
    [series.device, series.metric, window.start.toISOString(), window.end.toISOString()],
  );

  let readings = 0;
  for (const row of result.rows as SourceRow[]) {
    if (writeRow(sink, chunk, series, row, isConfig)) readings += 1;
  }
  return readings;
}

/** Every planned chunk, window by window and series by series. */
async function writeReadings(
  client: ReplayClient,
  request: ExportRequest,
  plan: ExportPlan,
  configKeys: ReadonlySet<string>,
  sink: ExportSink,
): Promise<BarrenChunk[]> {
  const seriesByTier = new Map<SourceTier, { device: string; metric: string }[]>();
  for (const tier of new Set(plan.chunks.map((chunk) => chunk.tier))) {
    seriesByTier.set(tier, await readSeries(client, request.source, tier));
  }
  const barren: BarrenChunk[] = [];
  for (const chunk of plan.chunks) {
    let chunkRows = 0;
    for (const window of windowsOf(chunk, WINDOW_DAYS[chunk.tier])) {
      let rows = 0;
      for (const series of seriesByTier.get(chunk.tier) ?? []) {
        rows += await writeSeries(
          client,
          request,
          chunk,
          window,
          series,
          sink,
          configKeys.has(series.metric),
        );
      }
      chunkRows += rows;
      request.onProgress?.({ tier: chunk.tier, window, rows, total: sink.readings.lines });
    }
    if (chunkRows === 0) {
      barren.push({
        ...chunk,
        reason:
          `the plan assigned this day to the ${chunk.tier} tier and it produced no rows — ` +
          `either the day is genuinely empty, or that tier's values are all NULL for it`,
      });
    }
  }
  return barren;
}

/**
 * A NATIVE export's config log, read straight out of `metrics_config_log`.
 *
 * Nothing to collapse: 2.0.0 already keeps configuration out of the hypertable
 * and records only changes, so this is a copy rather than a derivation.
 */
async function writeNativeConfigLog(client: ReplayClient, sink: ExportSink): Promise<void> {
  for (const row of await rowsOf(
    client,
    `select l.time as t, d.slug as device, mk.key as metric, l.value as v
     from metrics_config_log l
     join devices d on d.id = l.device_id
     join metric_keys mk on mk.id = l.metric_id
     order by l.time, d.slug, mk.key`,
  )) {
    const at = asDate(row.t);
    if (at === null || row.v === null) continue;
    // NAMED IN THE MANIFEST, exactly as a reading's identities are. The import
    // resolves `metric_keys` and `devices` from `manifest.metrics` /
    // `manifest.devices` alone, so a metric that only ever appears in the config
    // log — `optimizer.enabled`, `optimizer.mode`, `optimizer.restore.pending`,
    // and every `setting.*` on a device whose readings fell outside the exported
    // window — reached the far side with no id to key it to. That is not a
    // silent drop: `metrics_config_log.metric_id` is NOT NULL, so the whole
    // import fails on the insert.
    sink.devices.add(String(row.device));
    sink.metrics.add(String(row.metric));
    write(
      sink,
      sink.configLog,
      encodeConfigLog({
        time: at,
        deviceSlug: String(row.device),
        metricKey: String(row.metric),
        value: Number(row.v),
      }),
    );
    sink.streams.configLog += 1;
  }
}

/**
 * Export `client`'s history and configuration to `request.out`.
 *
 * The order below is the whole of the streaming story: the readings are read and
 * compressed into a SPOOL first (so memory never scales with the export), the
 * manifest is built from the counts that spool reports (which is why it cannot
 * be written first), and only then is the container assembled around them.
 */
export async function exportArchive(
  client: ReplayClient,
  request: ExportRequest,
): Promise<ExportResult> {
  const began = Date.now();
  const windows = await readSourceWindows(
    client,
    request.source,
    request.tiers ?? DEFAULT_TIERS[request.source],
  );
  const settings = await readSettings(client);
  const config = await readConfig(client, request, settings);
  const plan = planFor(windows);

  const sink: ExportSink = {
    readings: createLineSpool(MEMBERS.readings, `${request.workDir}/readings.ndjson.gz`),
    configLog: createLineSpool(MEMBERS.configLog, `${request.workDir}/config-log.ndjson.gz`),
    streams: emptyStreamCounts(),
    devices: new Set<string>(),
    metrics: new Set<string>(),
    uncompressedBytes: 0,
    changed: createChangeFilter(),
  };

  const barren = await writeReadings(client, request, plan, new Set(config.configKeys), sink);
  if (request.source === "native") await writeNativeConfigLog(client, sink);

  const readings = await sink.readings.close();
  const configLog = await sink.configLog.close();

  const manifest = buildManifest({
    createdAt: new Date(),
    source: await fingerprint(client, request.source, request.appVersion),
    plantTimeZone: config.plant?.timeZone ?? "auto",
    streams: sink.streams,
    span: { from: plan.chunks[0]?.start ?? null, to: plan.chunks.at(-1)?.end ?? null },
    devices: [...sink.devices].sort(),
    metrics: [...sink.metrics].sort(),
  });

  const encoder = new TextEncoder();
  const bytes = await writeArchive(request.out, [
    { name: MEMBERS.manifest, bytes: encoder.encode(`${JSON.stringify(manifest, null, 2)}\n`) },
    { name: MEMBERS.config, bytes: encoder.encode(`${JSON.stringify(config, null, 2)}\n`) },
    configLog,
    readings,
  ]);

  return {
    path: request.out,
    barren,
    bytes,
    uncompressedBytes: sink.uncompressedBytes,
    manifest,
    plan,
    elapsedMs: Date.now() - began,
  };
}
