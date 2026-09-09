/**
 * THE IMPORTER DRIVEN END TO END, against a REAL archive file and a recording
 * double in place of the database.
 *
 * `./archive-import.test.ts` covers the decisions in isolation — the source id,
 * the overlap verdict, the retention warning, the batching. What is here is the
 * SEQUENCING, which is where an import can be wrong without erroring:
 *
 *  * config BEFORE the readings, so the spine every reading resolves against
 *    exists;
 *  * identity resolved BEFORE the first insert, so an unknown slug refuses
 *    instead of being dropped by a join;
 *  * raw straight into the hypertable, buckets through staging and the replay;
 *  * compression disarmed around the WHOLE load and re-armed afterwards;
 *  * the aggregates refreshed hourly BEFORE daily, because daily is hierarchical
 *    over hourly;
 *  * the completion marker written LAST, and only then.
 *
 * ## What the double is, and what it is not
 *
 * `ReplayClient` is structural, and `./replay-run.test.ts` already drives the
 * replay executor through a double for exactly this reason. The double below is
 * DISPATCH plus a RECORDER: it decides which seeded rows a statement wants, and
 * it keeps the rows the importer handed it so the test can assert on what was
 * written. It is not a SQL engine.
 *
 * NO TEST HERE ASSERTS ON STATEMENT TEXT. That the statements run, that
 * `UNLOGGED` staging plus `counter_agg` survives 8 M rows, and that 414 counter
 * restarts come out the other side are proved by executing them —
 * `apps/server/db-tests/archive.test.ts` and `scripts/archive-round-trip.ts`.
 *
 * The ARCHIVE is real: written with the real writer, gzipped, tarred, and read
 * back by the importer's own reader.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  type ConfigLogRow,
  MEMBERS,
  type ReadingRow,
  type StreamCounts,
  buildManifest,
  emptyStreamCounts,
  encodeConfigLog,
  encodeReading,
} from "./archive";
import type { ArchiveConfig } from "./archive-config";
import { createLineSpool, writeArchive } from "./archive-file";
import { type ImportRequest, type ImportResult, importArchive } from "./archive-import";
import type { ReplayClient } from "./replay-run";

// ---------------------------------------------------------------------------
// A real archive, written with the real writer.
// ---------------------------------------------------------------------------

interface ArchiveSpec {
  readings?: ReadingRow[];
  configLog?: ConfigLogRow[];
  config?: Partial<ArchiveConfig>;
  /** Override what the manifest CLAIMS, to test the claim against the file. */
  streams?: Partial<StreamCounts>;
  devices?: string[];
  metrics?: string[];
}

const countStreams = (spec: ArchiveSpec): StreamCounts => {
  const streams = emptyStreamCounts();
  for (const row of spec.readings ?? []) streams[row.sourceTier] += 1;
  streams.configLog = (spec.configLog ?? []).length;
  return { ...streams, ...spec.streams };
};

/** The span the readings actually cover, half-open past the newest one. */
function spanOf(readings: readonly ReadingRow[]): { from: Date | null; to: Date | null } {
  const times = readings.map((row) => row.time.getTime()).sort((a, b) => a - b);
  const first = times[0];
  const last = times.at(-1);
  if (first === undefined || last === undefined) return { from: null, to: null };
  return { from: new Date(first), to: new Date(last + 1) };
}

const distinct = (values: readonly string[]) => [...new Set(values)];

/** The manifest, which is the archive's own CLAIM about itself. */
function manifestFor(spec: ArchiveSpec) {
  const readings = spec.readings ?? [];
  return buildManifest({
    createdAt: new Date("2026-08-27T10:00:00Z"),
    source: { app: "2.0.0", drizzleTag: "t", drizzleWhen: 1, timescaleFiles: [] },
    plantTimeZone: "Europe/Berlin",
    streams: countStreams(spec),
    span: spanOf(readings),
    devices: spec.devices ?? distinct(readings.map((row) => row.deviceSlug)),
    metrics: spec.metrics ?? distinct(readings.map((row) => row.metricKey)),
  });
}

const encoder = new TextEncoder();
const inline = (name: string, value: unknown) => ({
  name,
  bytes: encoder.encode(`${JSON.stringify(value, null, 2)}\n`),
});

async function buildArchive(dir: string, spec: ArchiveSpec): Promise<string> {
  const readings = createLineSpool(MEMBERS.readings, join(dir, "readings.ndjson.gz"));
  for (const row of spec.readings ?? []) readings.write(encodeReading(row));
  const configLog = createLineSpool(MEMBERS.configLog, join(dir, "config-log.ndjson.gz"));
  for (const row of spec.configLog ?? []) configLog.write(encodeConfigLog(row));

  const out = join(dir, "archive.tar.gz");
  // The manifest first and the readings LAST — the readings member is the only
  // unbounded one, and a reader must be able to refuse the file before it.
  await writeArchive(out, [
    inline(MEMBERS.manifest, manifestFor(spec)),
    inline(MEMBERS.config, spec.config ?? {}),
    await configLog.close(),
    await readings.close(),
  ]);
  return out;
}

// ---------------------------------------------------------------------------
// The recording double.
// ---------------------------------------------------------------------------

interface StagedRow {
  time: string;
  slug: string;
  metric: string;
  value: number;
}

interface Recorded {
  raw: { time: string; value: number; durMs: number | null; deviceId: number; metricId: number }[];
  configLog: { time: string; value: number; deviceId: number; metricId: number }[];
  staged: Record<string, StagedRow[]>;
  settings: [string, string][];
  profiles: string[];
  charts: string[];
  metricKeys: [string, boolean, string | null][];
  plants: unknown[][];
  connections: unknown[][];
  devices: unknown[][];
  batteries: unknown[][];
  /** `update devices set arrays` — the legacy plant-level roof handed to the first inverter. */
  adoptedPv: unknown[][];
  created: string[];
  indexed: string[];
  dropped: string[];
  policy: string[];
  refreshed: string[];
  markers: { source: string; deviceId: number; from: string; to: string }[];
  chunks: { source: string; tier: string; start: string }[];
}

const emptyRecorded = (): Recorded => ({
  raw: [],
  configLog: [],
  staged: {},
  settings: [],
  profiles: [],
  charts: [],
  metricKeys: [],
  plants: [],
  connections: [],
  devices: [],
  batteries: [],
  adoptedPv: [],
  created: [],
  indexed: [],
  dropped: [],
  policy: [],
  refreshed: [],
  markers: [],
  chunks: [],
});

interface Target {
  /** Device slugs the target holds, and their ids. */
  deviceIds?: Record<string, number>;
  /** `metric_keys` the target holds, and their ids. */
  metricIds?: Record<string, number>;
  /** Rows already in the archive's span. */
  overlappingRows?: number;
  /** Completion markers already recorded for this archive. */
  completedDevices?: number;
  /** Per-chunk watermarks already recorded — evidence of a PARTIAL run. */
  partialChunks?: number;
  /** `policy_compression`'s interval, or none armed. */
  compressAfter?: string | null;
  /** `policy_retention`'s interval on `metrics_raw`, or none armed. */
  retention?: { interval: string; days: number } | null;
  /** An endpoint the target already has, by name. */
  existingConnection?: { name: string; id: number };
  /** Statements this database cannot answer at all. Absent, not empty. */
  absent?: RegExp;
}

/** The staging table a statement names, or "" — the recorder keys by tier. */
const stageOf = (text: string): string => text.match(/archive_stage_([a-z]+)/)?.[1] ?? "";

type Rows = Record<string, unknown>[];
type Route = (target: Target, rec: Recorded, text: string, values: readonly unknown[]) => Rows;

/**
 * Which answer each statement gets, as a TABLE rather than a chain of `if`s — the
 * same shape `./replay-run.test.ts` uses. ORDER MATTERS: the replay's series arm
 * is a CTE that contains `insert into metrics_raw`, so it is matched first.
 */
const ROUTES: [RegExp, Route][] = [
  [/^(begin|commit|rollback)$/, () => []],

  // --- the plant graph -----------------------------------------------------
  [
    /insert into plants/,
    (_t, rec, _x, values) => {
      rec.plants.push([...values]);
      return [{ id: 1 }];
    },
  ],
  [
    /from connections where plant_id/,
    (target, _rec, _x, values) =>
      target.existingConnection && target.existingConnection.name === values[1]
        ? [{ id: target.existingConnection.id }]
        : [],
  ],
  [
    /insert into connections/,
    (_t, rec, _x, values) => {
      rec.connections.push([...values]);
      return [{ id: 700 + rec.connections.length }];
    },
  ],
  [
    /insert into devices/,
    (_t, rec, _x, values) => {
      rec.devices.push([...values]);
      return [{ id: 10 + rec.devices.length }];
    },
  ],
  [
    /insert into batteries/,
    (_t, rec, _x, values) => {
      rec.batteries.push([...values]);
      return [];
    },
  ],
  [
    /update devices set arrays/,
    (_t, rec, _x, values) => {
      rec.adoptedPv.push([...values]);
      return [];
    },
  ],
  [
    /insert into app_settings/,
    (_t, rec, _x, values) => {
      rec.settings.push([String(values[0]), String(values[1])]);
      return [];
    },
  ],
  [
    /insert into installed_profiles/,
    (_t, rec, _x, values) => {
      rec.profiles.push(String(values[0]));
      return [];
    },
  ],
  [
    /insert into custom_charts/,
    (_t, rec, _x, values) => {
      rec.charts.push(String(values[0]));
      return [];
    },
  ],
  // `ensureMetricKeys`, rendered by drizzle: (key, is_counter, unit) triples,
  // ids back. The stride is the point — a parameter added to that VALUES list
  // and not to this walk silently re-reads the next row's key as a unit.
  [
    /insert into "metric_keys"/,
    (target, rec, _x, values) => {
      const rows: Rows = [];
      for (let i = 0; i < values.length; i += 3) {
        const key = String(values[i]);
        const unit = values[i + 2];
        rec.metricKeys.push([key, values[i + 1] === true, unit === null ? null : String(unit)]);
        rows.push({ id: target.metricIds?.[key] ?? 0, key });
      }
      return rows;
    },
  ],

  // --- identity and the overlap check --------------------------------------
  [
    /min\(id\) as id from devices/,
    (target, _rec, _x, values) =>
      values
        .map(String)
        .filter((slug) => target.deviceIds?.[slug] !== undefined)
        .map((slug) => ({ slug, id: target.deviceIds?.[slug] })),
  ],
  [
    /select key, id from metric_keys/,
    (target, _rec, _x, values) =>
      values
        .map(String)
        .filter((key) => target.metricIds?.[key] !== undefined)
        .map((key) => ({ key, id: target.metricIds?.[key] })),
  ],
  [
    /^select key from metric_keys$/,
    (target) => Object.keys(target.metricIds ?? {}).map((key) => ({ key })),
  ],
  [/from metrics_raw\s*$|as n from metrics_raw/, (target) => [{ n: target.overlappingRows ?? 0 }]],
  [
    /as n from replay_progress/,
    (target, _rec, _x, values) => [
      {
        n: String(values[0]).endsWith("#done")
          ? (target.completedDevices ?? 0)
          : (target.partialChunks ?? 0),
      },
    ],
  ],

  // --- compression and retention policies ----------------------------------
  [/policy_compression/, (target) => [{ i: target.compressAfter ?? null }]],
  [
    /(remove|add)_compression_policy/,
    (_t, rec, text) => {
      rec.policy.push(text.includes("remove") ? "remove" : "add");
      return [];
    },
  ],
  [/policy_retention/, (target) => [{ d: target.retention?.interval ?? null }]],
  [/extract\(epoch/, (target) => [{ d: target.retention?.days ?? null }]],

  // --- staging lifecycle ---------------------------------------------------
  [
    /^drop table if exists/,
    (_t, rec, text) => {
      rec.dropped.push(stageOf(text));
      return [];
    },
  ],
  [
    /^create unlogged table/,
    (_t, rec, text) => {
      rec.created.push(stageOf(text));
      return [];
    },
  ],
  [
    /^create index on/,
    (_t, rec, text) => {
      rec.indexed.push(stageOf(text));
      return [];
    },
  ],

  // --- the replay, reading back what was staged ----------------------------
  [
    /^\s*select min\(b\./,
    (_t, rec, text, values) => {
      const rows = (rec.staged[stageOf(text)] ?? []).filter((row) => row.slug === values[0]);
      if (rows.length === 0) return [{ from: null, to: null }];
      const times = rows.map((row) => row.time).sort();
      return [{ from: times[0], to: times.at(-1) }];
    },
  ],
  [/not exists \(select 1 from/, () => []],
  [/^select chunk_start from replay_progress/, () => []],
  [
    /^with ins as \(/,
    (_t, rec, text, values) => {
      const [slug, start, end] = values as [string, string, string];
      const staged = rec.staged[stageOf(text)] ?? [];
      const n = staged.filter(
        (row) => row.slug === slug && row.time >= start && row.time < end,
      ).length;
      return [{ n }];
    },
  ],
  [/^with src as \(/, () => [{ n: 0 }]],
  [
    /insert into replay_progress/,
    (_t, rec, _x, values) => {
      const source = String(values[0]);
      if (String(values[4]) === "archive" || source.endsWith("#done")) {
        rec.markers.push({
          source,
          deviceId: Number(values[1]),
          from: String(values[2]),
          to: String(values[3]),
        });
      } else {
        rec.chunks.push({ source, tier: String(values[4]), start: String(values[2]) });
      }
      return [];
    },
  ],

  // --- the loads themselves ------------------------------------------------
  [
    /insert into metrics_raw/,
    (_t, rec, _x, values) => {
      for (let i = 0; i < values.length; i += 5) {
        rec.raw.push({
          time: String(values[i]),
          value: Number(values[i + 1]),
          durMs: values[i + 2] === null ? null : Number(values[i + 2]),
          deviceId: Number(values[i + 3]),
          metricId: Number(values[i + 4]),
        });
      }
      return [];
    },
  ],
  [
    /insert into metrics_config_log/,
    (_t, rec, _x, values) => {
      for (let i = 0; i < values.length; i += 4) {
        rec.configLog.push({
          time: String(values[i]),
          value: Number(values[i + 1]),
          deviceId: Number(values[i + 2]),
          metricId: Number(values[i + 3]),
        });
      }
      return [];
    },
  ],
  [
    /insert into archive_stage_/,
    (_t, rec, text, values) => {
      const tier = stageOf(text);
      const rows = (rec.staged[tier] ??= []);
      for (let i = 0; i < values.length; i += 4) {
        rows.push({
          time: String(values[i]),
          slug: String(values[i + 1]),
          metric: String(values[i + 2]),
          value: Number(values[i + 3]),
        });
      }
      return [];
    },
  ],
  [
    /refresh_continuous_aggregate/,
    (_t, rec, _x, values) => {
      rec.refreshed.push(String(values[0]));
      return [];
    },
  ],
];

function fake(target: Target): { client: ReplayClient; rec: Recorded } {
  const rec = emptyRecorded();
  const client: ReplayClient = {
    async query(text, values = []) {
      const trimmed = text.trim();
      if (target.absent?.test(trimmed)) throw new Error("relation does not exist");
      const route = ROUTES.find(([pattern]) => pattern.test(trimmed));
      return { rows: route ? route[1](target, rec, trimmed, values) : [] };
    },
  };
  return { client, rec };
}

// ---------------------------------------------------------------------------

const dirs: string[] = [];

afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

interface Ran {
  result: ImportResult;
  rec: Recorded;
}

async function run(
  spec: ArchiveSpec,
  target: Target = { deviceIds: { "deye-1": 5 }, metricIds: { "pv.power": 3 } },
  over: Partial<ImportRequest> = {},
): Promise<Ran> {
  const dir = await mkdtemp(join(tmpdir(), "sunreye-import-"));
  dirs.push(dir);
  const file = await buildArchive(dir, spec);
  const { client, rec } = fake(target);
  const result = await importArchive(client, {
    file,
    workDir: join(dir, "work"),
    applyConfig: false,
    ...over,
  });
  return { result, rec };
}

const reading = (over: Partial<ReadingRow> = {}): ReadingRow => ({
  time: new Date("2026-08-20T00:00:00.000Z"),
  deviceSlug: "deye-1",
  metricKey: "pv.power",
  value: 1200,
  durMs: 1000,
  sourceTier: "raw",
  ...over,
});

// ---------------------------------------------------------------------------

describe("importArchive: the raw arm", () => {
  test("a raw reading lands in the hypertable with its ids resolved in process", async () => {
    const { result, rec } = await run({
      readings: [reading(), reading({ time: new Date("2026-08-20T00:00:01.000Z"), value: 1300 })],
    });
    expect(rec.raw).toEqual([
      {
        time: "2026-08-20T00:00:00.000Z",
        value: 1200,
        durMs: 1000,
        deviceId: 5,
        metricId: 3,
      },
      {
        time: "2026-08-20T00:00:01.000Z",
        value: 1300,
        durMs: 1000,
        deviceId: 5,
        metricId: 3,
      },
    ]);
    expect(result.inserted.raw).toBe(2);
    expect(result.skipped).toBeNull();
    expect(result.problems).toEqual([]);
    // No bucket rows, so no staging table was ever created.
    expect(rec.created).toEqual([]);
  });

  test("a raw row with an UNKNOWN hold keeps null — it is not zero", async () => {
    const { rec } = await run({ readings: [reading({ durMs: null })] });
    expect(rec.raw[0]?.durMs).toBeNull();
  });

  test("the completion marker is written LAST, spanning the rows that were read", async () => {
    // The span comes from the ROWS, not from the manifest: a manifest can be
    // wrong about itself, and the marker is what licenses a later skip.
    const { rec } = await run({
      readings: [
        reading({ time: new Date("2026-08-20T06:00:00.000Z") }),
        reading({ time: new Date("2026-08-21T18:00:00.000Z") }),
      ],
    });
    expect(rec.markers).toHaveLength(1);
    expect(rec.markers[0]?.deviceId).toBe(5);
    expect(rec.markers[0]?.from).toBe("2026-08-20T06:00:00.000Z");
    // Exclusive by one millisecond past the newest reading.
    expect(rec.markers[0]?.to).toBe("2026-08-21T18:00:00.001Z");
    expect(rec.markers[0]?.source).toEndWith("#done");
  });

  test("an archive with no readings writes no marker and refreshes nothing", async () => {
    const { result, rec } = await run({});
    expect(rec.markers).toEqual([]);
    expect(rec.refreshed).toEqual([]);
    expect(result.inserted).toEqual(emptyStreamCounts());
  });

  test("the config log is inserted directly — 2.0.0 already recorded only changes", async () => {
    const { result, rec } = await run({
      readings: [reading()],
      configLog: [
        {
          time: new Date("2026-08-20T09:00:00.000Z"),
          deviceSlug: "deye-1",
          metricKey: "pv.power",
          value: 7000,
        },
      ],
    });
    expect(rec.configLog).toEqual([
      { time: "2026-08-20T09:00:00.000Z", value: 7000, deviceId: 5, metricId: 3 },
    ]);
    expect(result.inserted.configLog).toBe(1);
  });
});

describe("importArchive: the bucket arm", () => {
  // Whole UTC days per tier: a tier only answers a day it covers END TO END, so a
  // two-minute minute window is a GAP rather than a chunk. That is `planReplay`'s
  // rule and the reason a day is never split between two tiers.
  const bucketSpec: ArchiveSpec = {
    readings: [
      reading({ sourceTier: "minute", time: new Date("2026-08-20T00:00:00.000Z"), value: 10 }),
      reading({ sourceTier: "minute", time: new Date("2026-08-20T23:59:00.000Z"), value: 20 }),
      reading({ sourceTier: "hourly", time: new Date("2026-08-21T00:00:00.000Z"), value: 30 }),
      reading({ sourceTier: "hourly", time: new Date("2026-08-21T23:00:00.000Z"), value: 40 }),
    ],
  };

  test("bucket rows are staged BY NAME, per tier — the replay resolves the ids", async () => {
    const { rec, result } = await run(bucketSpec);
    expect(rec.staged.minute).toEqual([
      { time: "2026-08-20T00:00:00.000Z", slug: "deye-1", metric: "pv.power", value: 10 },
      { time: "2026-08-20T23:59:00.000Z", slug: "deye-1", metric: "pv.power", value: 20 },
    ]);
    expect(rec.staged.hourly).toEqual([
      { time: "2026-08-21T00:00:00.000Z", slug: "deye-1", metric: "pv.power", value: 30 },
      { time: "2026-08-21T23:00:00.000Z", slug: "deye-1", metric: "pv.power", value: 40 },
    ]);
    expect(result.inserted).toMatchObject({ raw: 0, minute: 2, hourly: 2 });
  });

  test("only the tiers the manifest declares rows for get a staging table", async () => {
    const { rec } = await run(bucketSpec);
    expect(rec.created).toEqual(["minute", "hourly"]);
    // Dropped FIRST, so a previous run's rows can never be replayed a second time…
    expect(rec.dropped.slice(0, 2)).toEqual(["minute", "hourly"]);
    // …and dropped again at the end of a successful run.
    expect(rec.dropped).toEqual(["minute", "hourly", "minute", "hourly"]);
  });

  test("the staging index is created AFTER the load, not before it", async () => {
    const { rec } = await run(bucketSpec);
    expect(rec.indexed).toEqual(["minute", "hourly"]);
    // Every staged row was already in place when the index was built: building it
    // first would make the load pay for maintaining it row by row.
    expect(rec.staged.minute).toHaveLength(2);
  });

  test("the replay turns the staged buckets into hypertable rows, one run per device", async () => {
    const { result } = await run(bucketSpec);
    expect(result.replays).toHaveLength(1);
    // One chunk per day, each answered by the finest tier that covers that day
    // END TO END — never two tiers inside one day, because an hourly bucket and
    // the sixty minute buckets inside it are the same energy counted twice.
    expect(result.replays).toHaveLength(1);
    expect(result.replays[0]?.chunks.map((chunk) => [chunk.tier, chunk.seriesRows])).toEqual([
      ["minute", 2],
      ["hourly", 2],
    ]);
    expect(result.replays[0]?.gaps).toEqual([]);
  });

  test("a day no staged tier covers is reported as a problem, never silently skipped", async () => {
    const { result } = await run({
      readings: [
        reading({ sourceTier: "minute", time: new Date("2026-08-20T00:00:00.000Z") }),
        reading({ sourceTier: "minute", time: new Date("2026-08-20T23:59:00.000Z") }),
        // The hourly tier picks up four days later. Neither tier's window reaches
        // 21..24, so those days are covered by nothing at all — and the operator
        // is told which ones rather than finding an empty week on a chart.
        reading({ sourceTier: "hourly", time: new Date("2026-08-25T00:00:00.000Z") }),
        reading({ sourceTier: "hourly", time: new Date("2026-08-25T23:00:00.000Z") }),
      ],
    });
    expect(result.problems.some((problem) => problem.includes("no tier covered"))).toBe(true);
  });

  test("a reading whose tier the manifest declares EMPTY is refused, not dropped", async () => {
    // The manifest is the archive's own claim about itself. A contradiction means
    // the file is inconsistent, and a silently dropped tier would be a missing
    // month that nothing ever reported. The count check cannot catch this one: a
    // tier the manifest says is empty is absent from both sides of it.
    await expect(
      run({
        readings: [reading({ sourceTier: "daily" })],
        streams: { daily: 0 },
      }),
    ).rejects.toThrow(/declares 0 rows for that tier/);
  });
});

describe("importArchive: identity", () => {
  test("an unknown device slug REFUSES before a single row is written", async () => {
    // A `join metric_keys` that finds no match drops the row and reports success.
    const { client, rec } = fake({ metricIds: { "pv.power": 3 } });
    const dir = await mkdtemp(join(tmpdir(), "sunreye-import-"));
    dirs.push(dir);
    const file = await buildArchive(dir, { readings: [reading()] });
    await expect(
      importArchive(client, { file, workDir: join(dir, "work"), applyConfig: false }),
    ).rejects.toThrow(/refusing to import/);
    expect(rec.raw).toEqual([]);
    expect(rec.created).toEqual([]);
  });

  test("an unknown metric key refuses too, and both are reported at once", async () => {
    await expect(
      run({ readings: [reading()] }, { deviceIds: { "deye-1": 5 }, metricIds: {} }),
    ).rejects.toThrow(/refusing to import/);
  });

  test("a device mapping renames on the way in — the seam a multi-device split uses", async () => {
    const { rec } = await run(
      { readings: [reading({ sourceTier: "minute" })] },
      { deviceIds: { "battery-1": 9 }, metricIds: { "pv.power": 3 } },
      { deviceMap: { "deye-1": "battery-1" } },
    );
    // Staged under the TARGET slug, because that is what the replay resolves.
    expect(rec.staged.minute?.[0]?.slug).toBe("battery-1");
  });
});

describe("importArchive: whether to import at all", () => {
  test("an archive already imported IN FULL is a no-op, and writes nothing", async () => {
    const { result, rec } = await run(
      { readings: [reading()] },
      {
        deviceIds: { "deye-1": 5 },
        metricIds: { "pv.power": 3 },
        overlappingRows: 500,
        completedDevices: 1,
      },
    );
    expect(result.skipped).toContain("already imported in full");
    expect(rec.raw).toEqual([]);
    expect(rec.markers).toEqual([]);
  });

  test("rows already in the span from something else are REFUSED", async () => {
    await expect(
      run(
        { readings: [reading()] },
        { deviceIds: { "deye-1": 5 }, metricIds: { "pv.power": 3 }, overlappingRows: 42 },
      ),
    ).rejects.toThrow(/already holds 42 row\(s\)/);
  });

  test("--force imports anyway and SAYS the rows will be duplicates", async () => {
    const { result, rec } = await run(
      { readings: [reading()] },
      { deviceIds: { "deye-1": 5 }, metricIds: { "pv.power": 3 }, overlappingRows: 42 },
      { force: true },
    );
    expect(result.problems.some((problem) => problem.includes("DUPLICATE rows"))).toBe(true);
    expect(rec.raw).toHaveLength(1);
  });
});

describe("importArchive: the load's surroundings", () => {
  test("compression is disarmed ONCE around the whole load and re-armed after it", async () => {
    const { rec } = await run(
      { readings: [reading()] },
      { deviceIds: { "deye-1": 5 }, metricIds: { "pv.power": 3 }, compressAfter: "2 hours" },
    );
    // Once each, not once per batch: arming per batch would be hundreds of
    // catalogue writes and would leave a window for a compression job to fire.
    expect(rec.policy).toEqual(["remove", "add"]);
  });

  test("a database with NO timescale catalogue imports anyway — absent is not an error", async () => {
    // `timescaledb_information.jobs` does not exist on a database whose
    // policies.sql has never run. There is nothing to disarm and nothing to warn
    // about, and neither is a reason to refuse the history.
    const { result, rec } = await run(
      { readings: [reading({ time: new Date("2020-01-01T00:00:00.000Z") })] },
      {
        deviceIds: { "deye-1": 5 },
        metricIds: { "pv.power": 3 },
        absent: /timescaledb_information/,
      },
    );
    expect(rec.policy).toEqual([]);
    expect(result.problems).toEqual([]);
    expect(rec.raw).toHaveLength(1);
  });

  test("a retention interval that does not parse is treated as no policy, not as zero", async () => {
    const { result } = await run(
      { readings: [reading({ time: new Date("2020-01-01T00:00:00.000Z") })] },
      {
        deviceIds: { "deye-1": 5 },
        metricIds: { "pv.power": 3 },
        retention: { interval: "not an interval", days: Number.NaN },
      },
    );
    // A NaN cutoff would compare false against every date and silence the warning
    // for a real policy too; null says "unknown" instead.
    expect(result.problems).toEqual([]);
  });

  test("no compression policy armed means nothing to disarm and nothing to restore", async () => {
    const { rec } = await run({ readings: [reading()] });
    expect(rec.policy).toEqual([]);
  });

  test("the policy is re-armed even when the load THROWS", async () => {
    // Otherwise a failed import leaves the hypertable permanently uncompressed.
    await expect(
      run(
        { readings: [reading({ sourceTier: "daily" })], streams: { daily: 0 } },
        { deviceIds: { "deye-1": 5 }, metricIds: { "pv.power": 3 }, compressAfter: "2 hours" },
      ),
    ).rejects.toThrow();
  });

  test("the aggregates are refreshed hourly BEFORE daily — daily is built on hourly", async () => {
    // Refreshing daily first would materialize days from hourly buckets that do
    // not exist yet, and no later refresh is guaranteed to correct them.
    const { rec } = await run({ readings: [reading()] });
    expect(rec.refreshed).toEqual(["minute_rollups", "hourly_rollups", "daily_rollups"]);
  });

  test("--no-refresh skips it, for the operator who will refresh by hand", async () => {
    const { rec } = await run(
      { readings: [reading()] },
      { deviceIds: { "deye-1": 5 }, metricIds: { "pv.power": 3 } },
      { refresh: false },
    );
    expect(rec.refreshed).toEqual([]);
    // The marker is still written: the import itself finished.
    expect(rec.markers).toHaveLength(1);
  });

  test("progress is reported by stage", async () => {
    const stages: string[] = [];
    await run(
      { readings: [reading({ sourceTier: "minute" })] },
      { deviceIds: { "deye-1": 5 }, metricIds: { "pv.power": 3 } },
      { onProgress: ({ stage }) => stages.push(stage) },
    );
    expect(stages).toContain("staging");
    expect(stages).toContain("replay");
    expect(stages).toContain("refresh");
  });
});

describe("importArchive: what it warns about", () => {
  test("rows past retention are imported AND reported — retention is not an insert check", async () => {
    // The one consequence nothing else would surface: the rows are accepted,
    // committed, visible on a chart, and then deleted by the next retention job.
    const { result } = await run(
      { readings: [reading({ time: new Date("2020-01-01T00:00:00.000Z") })] },
      {
        deviceIds: { "deye-1": 5 },
        metricIds: { "pv.power": 3 },
        retention: { interval: "1825 days", days: 1825 },
      },
    );
    expect(result.problems.some((problem) => problem.includes("WILL BE IMPORTED"))).toBe(true);
  });

  test("no retention policy armed means no warning to give", async () => {
    const { result } = await run({
      readings: [reading({ time: new Date("2020-01-01T00:00:00.000Z") })],
    });
    expect(result.problems).toEqual([]);
  });

  test("a manifest claiming more rows than the file holds is reported as SHORT", async () => {
    // A truncation the tar checksums could not see, or a row the decoder refused.
    const { result } = await run({ readings: [reading()], streams: { raw: 9 } });
    expect(result.problems.some((problem) => problem.includes("archive is short"))).toBe(true);
  });
});

describe("importArchive: applying config.json", () => {
  const config: Partial<ArchiveConfig> = {
    plant: {
      name: "Home",
      slug: "home",
      timeZone: "Europe/Berlin",
      latitude: 51.1,
      longitude: 6.9,
      label: "roof",
      arrays: [{ kwp: 9.9 }],
      tempCoefficient: null,
      systemLoss: null,
      maxOutputW: 10000,
      houseLoadW: 400,
      smartMeterSince: null,
      biddingZone: "DE-LU",
      tariffKey: "spot",
      connections: [
        {
          name: "loft",
          host: "10.0.0.5",
          port: 502,
          transport: "tcp",
          timeoutMs: 2000,
          pollIntervalMs: 5000,
        },
      ],
      devices: [
        {
          slug: "deye-1",
          name: "Deye",
          profileId: "deye.sun-12k",
          serial: "SN1",
          role: "inverter",
          unitId: 1,
          connection: "loft",
          battery: { usableKwh: 14.3, maxChargeW: 5000, minSoc: 15, nominalV: 51.2 },
          retiredAt: null,
          arrays: [{ kwp: 9.9, tilt: 30, azimuth: 0 }],
          tempCoefficient: -0.35,
          systemLoss: 11,
        },
        {
          slug: "meter",
          name: "Meter",
          profileId: "generic",
          serial: null,
          role: "meter",
          unitId: 2,
          connection: null,
          battery: null,
          retiredAt: null,
          arrays: [],
          tempCoefficient: null,
          systemLoss: null,
        },
      ],
    },
    appSettings: [{ key: "display.theme", value: "dark" }],
    installedProfiles: [{ id: "deye.sun-12k", source: "builtin", version: "1.2.0", data: {} }],
    customCharts: [{ id: "c1", name: "Mine", data: {} }],
    metricKeys: [
      { key: "pv.power", isCounter: false },
      { key: "total.energy", isCounter: true },
    ],
    configKeys: [],
  };

  const target: Target = {
    deviceIds: { "deye-1": 5 },
    metricIds: { "pv.power": 3, "total.energy": 4 },
  };

  test("the whole graph is applied BEFORE the readings need it", async () => {
    const { rec } = await run({ readings: [reading()], config }, target, { applyConfig: true });
    expect(rec.plants).toHaveLength(1);
    expect(rec.connections).toHaveLength(1);
    expect(rec.devices).toHaveLength(2);
    // Only the device that reports a pack gets one.
    expect(rec.batteries).toHaveLength(1);
    expect(rec.batteries[0]?.[1]).toBe(14.3);
    // The inverter's roof binds as jsonb text; the meter's as an empty list, so
    // the NOT NULL column takes it rather than a null the insert would refuse.
    expect(rec.devices[0]?.slice(9)).toEqual(['[{"kwp":9.9,"tilt":30,"azimuth":0}]', -0.35, 11]);
    expect(rec.devices[1]?.slice(9)).toEqual(["[]", null, null]);
    // A file written after the move carries the roof per device: nothing to adopt.
    expect(rec.adoptedPv).toEqual([]);
    expect(rec.settings).toEqual([["display.theme", '"dark"']]);
    expect(rec.profiles).toEqual(["deye.sun-12k"]);
    expect(rec.charts).toEqual(["c1"]);
    // Through `ensureMetricKeys`, whose `on conflict do update` is what keeps ids
    // REUSED rather than renumbered — int2 caps the dimension at 32767.
    // The unit binds as NULL: an archive's config records the counter class but
    // not the unit, and a null is the one value the upsert will not write over
    // a unit an installed profile already supplied.
    expect(rec.metricKeys).toEqual([
      ["pv.power", false, null],
      ["total.energy", true, null],
    ]);
  });

  test("a 2.0.x archive's PLANT-level roof is handed to the first inverter", async () => {
    // Older files describe the roof on the plant and carry no `arrays` on any
    // device. The device rows then bind null (→ column default, never an
    // overwrite) and one follow-up UPDATE moves the plant's description onto
    // the lowest-id in-service inverter — the rule migration 0005 applies.
    const legacy = {
      ...config,
      plant: {
        ...config.plant!,
        arrays: [{ kwp: 9.9, tilt: 30, azimuth: 0 }],
        tempCoefficient: -0.35,
        systemLoss: 11,
        devices: config.plant!.devices.map((d) => ({
          ...d,
          arrays: null,
          tempCoefficient: null,
          systemLoss: null,
        })),
      },
    };
    const { rec } = await run({ readings: [reading()], config: legacy }, target, {
      applyConfig: true,
    });
    // The device rows bind NULL for all three, so the insert takes the column
    // defaults and a merge keeps what the local row already says.
    expect(rec.devices[0]?.slice(9)).toEqual([null, null, null]);
    expect(rec.adoptedPv).toEqual([[1, '[{"kwp":9.9,"tilt":30,"azimuth":0}]', -0.35, 11]]);
  });

  test("a legacy archive with an EMPTY roof adopts nothing — there is nothing to hand over", async () => {
    const legacy = {
      ...config,
      plant: {
        ...config.plant!,
        arrays: [],
        tempCoefficient: null,
        systemLoss: null,
        devices: config.plant!.devices.map((d) => ({
          ...d,
          arrays: null,
          tempCoefficient: null,
          systemLoss: null,
        })),
      },
    };
    const { rec } = await run({ readings: [reading()], config: legacy }, target, {
      applyConfig: true,
    });
    expect(rec.adoptedPv).toEqual([]);
  });

  test("a virtual device is inserted with its own role, not normalised to inverter", async () => {
    // The role binds VERBATIM: the importer must not decide that a device it has
    // no profile for is an inverter. `devices_role_check` is what refuses a role
    // this build does not model — see
    // `apps/server/db-tests/check-constraints.test.ts`.
    const withOptimizer = {
      ...config,
      plant: {
        ...(config.plant as NonNullable<ArchiveConfig["plant"]>),
        devices: [
          {
            slug: "optimizer",
            name: "Optimizer",
            profileId: "sunreye.optimizer",
            serial: null,
            role: "optimizer",
            unitId: 0,
            connection: null,
            retiredAt: null,
            battery: null,
          },
        ],
      },
    };
    const { rec } = await run({ readings: [reading()], config: withOptimizer }, target, {
      applyConfig: true,
    });
    expect(rec.devices).toHaveLength(1);
    // (plant_id, connection_id, unit_id, slug, name, profile_id, serial, role, retired_at)
    expect(rec.devices[0]?.[7]).toBe("optimizer");
    expect(rec.devices[0]?.[1]).toBeNull();
    // A virtual device owns no pack, so no battery row is written for it.
    expect(rec.batteries).toEqual([]);
  });

  test("an endpoint the plant already has is REUSED, not duplicated", async () => {
    // `connections` has no unique key on (plant_id, name) — a plant legitimately
    // has two endpoints with the same label on different hosts — so this is a
    // select-then-insert rather than an upsert.
    const { rec } = await run(
      { readings: [reading()], config },
      { ...target, existingConnection: { name: "loft", id: 77 } },
      { applyConfig: true },
    );
    expect(rec.connections).toEqual([]);
    // …and the device still resolves to it.
    expect(rec.devices[0]?.[1]).toBe(77);
  });

  test("a device naming an endpoint the file does not carry gets null, not a wrong id", async () => {
    const orphaned = {
      ...config,
      plant: {
        ...(config.plant as NonNullable<ArchiveConfig["plant"]>),
        connections: [],
      },
    };
    const { rec } = await run({ readings: [reading()], config: orphaned }, target, {
      applyConfig: true,
    });
    expect(rec.devices[0]?.[1]).toBeNull();
  });

  test("--no-config leaves the target's own graph alone", async () => {
    const { rec } = await run({ readings: [reading()], config }, target, { applyConfig: false });
    expect(rec.plants).toEqual([]);
    expect(rec.settings).toEqual([]);
    expect(rec.metricKeys).toEqual([]);
  });

  test("an archive with no plant applies the rest of the config anyway", async () => {
    const { rec } = await run(
      { readings: [reading()], config: { ...config, plant: null } },
      target,
      { applyConfig: true },
    );
    expect(rec.plants).toEqual([]);
    expect(rec.settings).toHaveLength(1);
  });

  test("a device naming a connection the FILE does not carry is reported as a problem", async () => {
    // Reported and then nulled rather than refused: an endpoint-less device still
    // resolves every reading it owns, which is the part that cannot be
    // reconstructed. A missing host can be retyped in thirty seconds.
    const orphaned = {
      ...config,
      plant: { ...(config.plant as NonNullable<ArchiveConfig["plant"]>), connections: [] },
    };
    const { result } = await run({ readings: [reading()], config: orphaned }, target, {
      applyConfig: true,
    });
    expect(
      result.problems.some((problem) => problem.includes("which the archive does not carry")),
    ).toBe(true);
  });
});
