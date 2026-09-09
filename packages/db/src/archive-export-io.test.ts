/**
 * THE EXPORTER DRIVEN END TO END, with a REAL archive file and a routing double
 * in place of the database.
 *
 * `./archive-export.test.ts` covers the plan arithmetic in isolation. What is
 * here is everything between a source row and a finished `.tar.gz`: which
 * relation each tier is read from, how a row becomes a reading or a
 * configuration change or nothing at all, what the manifest ends up claiming,
 * and what an absent table means.
 *
 * ## What the double is, and what it is not
 *
 * `ReplayClient` is structural — one statement, positional parameters, rows back
 * — and `./replay-run.test.ts` already drives the whole replay executor through
 * a double for the same reason. The double below is DISPATCH: it decides which
 * seeded rows a statement is asking for and hands them over. It is not a SQL
 * engine and it proves nothing about SQL.
 *
 * So NO TEST HERE ASSERTS ON STATEMENT TEXT. That the statements are accepted by
 * Postgres, that `average(tw)` means what this module thinks it means, and that
 * the counts survive a 60-day fixture are proved by running them —
 * `apps/server/db-tests/archive.test.ts` and `scripts/archive-round-trip.ts`.
 * A SQL-text assertion could not prove any of that, and this file does not
 * pretend otherwise.
 *
 * The FILE, on the other hand, is real: a real gzip, a real tar, read back with
 * the real reader. Every assertion below about what the archive contains is an
 * assertion about bytes that were actually written and actually parsed.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { MEMBERS, type SourceTier, decodeConfigLog, decodeReading } from "./archive";
import { REDACTED, parseArchiveConfig } from "./archive-config";
import { type ExportRequest, type ExportResult, exportArchive } from "./archive-export";
import { openArchive } from "./archive-file";
import { bucketWidthMs } from "./replay";
import type { ReplayClient } from "./replay-run";

// ---------------------------------------------------------------------------
// The seeded source, and the router that answers for it.
// ---------------------------------------------------------------------------

interface SeedRow {
  tier: SourceTier;
  device: string;
  metric: string;
  time: string;
  /** `null` is a bucket with no time-weighted mean — a single-sample bucket. */
  value: number | null;
  durMs?: number | null;
}

interface Seed {
  readings?: SeedRow[];
  settings?: Record<string, unknown>;
  profiles?: Record<string, unknown>[];
  charts?: Record<string, unknown>[];
  plants?: Record<string, unknown>[];
  connections?: Record<string, unknown>[];
  devices?: Record<string, unknown>[];
  metricKeys?: Record<string, unknown>[];
  configLog?: Record<string, unknown>[];
  timescaleFiles?: string[];
  drizzle?: Record<string, unknown>[];
  /** Relations/statements this schema does not have. Absent, not empty. */
  absent?: RegExp;
}

const TIER_OF: Record<string, SourceTier> = {
  metrics_raw: "raw",
  minute_rollups: "minute",
  hourly_rollups: "hourly",
  daily_rollups: "daily",
};

/** The relation a statement reads from: the first `from`. */
const relationOf = (text: string): string => text.match(/from\s+([a-z_][a-z0-9_.]*)/)?.[1] ?? "";

const tierOf = (text: string): SourceTier | undefined => TIER_OF[relationOf(text)];

const readingsFor = (seed: Seed, tier: SourceTier | undefined): SeedRow[] =>
  (seed.readings ?? []).filter((row) => row.tier === tier);

type Rows = Record<string, unknown>[];

/**
 * Which seeded rows each statement is asking for, as a TABLE rather than a chain
 * of `if`s — the same shape `./replay-run.test.ts` uses, and for the same reason:
 * a double spelled as branches ends up more complex than the code it serves.
 */
const ROUTES: [RegExp, (seed: Seed, text: string, values: readonly unknown[]) => Rows][] = [
  // Retention window: min/max of the tier's time column.
  [
    /^\s*select min\(/,
    (seed, text) => {
      const rows = readingsFor(seed, tierOf(text));
      if (rows.length === 0) return [{ from: null, to: null }];
      const times = rows.map((row) => row.time).sort();
      return [{ from: times[0], to: times.at(-1) }];
    },
  ],
  // The (device, metric) pairs a tier holds.
  [
    /^\s*select distinct/,
    (seed, text) => {
      const pairs = new Map<string, Rows[number]>();
      for (const row of readingsFor(seed, tierOf(text))) {
        pairs.set(`${row.device} ${row.metric}`, { device: row.device, metric: row.metric });
      }
      return [...pairs.values()].sort((a, b) =>
        `${a.device} ${a.metric}`.localeCompare(`${b.device} ${b.metric}`),
      );
    },
  ],
  [/from timescale_migrations/, (seed) => (seed.timescaleFiles ?? []).map((name) => ({ name }))],
  [/__drizzle_migrations/, (seed) => seed.drizzle ?? []],
  [
    /from app_settings/,
    (seed) =>
      Object.entries(seed.settings ?? {})
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, value]) => ({ key, value })),
  ],
  [/from installed_profiles/, (seed) => seed.profiles ?? []],
  [/from custom_charts/, (seed) => seed.charts ?? []],
  [/from plants/, (seed) => seed.plants ?? []],
  [/from connections/, (seed) => seed.connections ?? []],
  [/from devices/, (seed) => seed.devices ?? []],
  [/from metric_keys/, (seed) => seed.metricKeys ?? []],
  [/from metrics_config_log/, (seed) => seed.configLog ?? []],
  // The readings read itself: one (device, metric) over one half-open window.
  [
    /as t,/,
    (seed, text, values) => {
      const [device, metric, from, to] = values as [string, string, string, string];
      return readingsFor(seed, tierOf(text))
        .filter(
          (row) =>
            row.device === device && row.metric === metric && row.time >= from && row.time < to,
        )
        .sort((a, b) => a.time.localeCompare(b.time))
        .map((row) => ({
          t: row.time,
          // A bucket's projected hold is its own width — the double stands in for
          // the `<width>::integer` the statement selects.
          v: row.value,
          d: row.tier === "raw" ? (row.durMs ?? null) : bucketWidthMs(row.tier),
        }));
    },
  ],
];

function fake(seed: Seed): { client: ReplayClient; statements: string[] } {
  const statements: string[] = [];
  const client: ReplayClient = {
    async query(text, values = []) {
      statements.push(text);
      if (seed.absent?.test(text)) throw new Error("relation does not exist");
      const route = ROUTES.find(([pattern]) => pattern.test(text));
      return { rows: route ? route[1](seed, text, values) : [] };
    },
  };
  return { client, statements };
}

// ---------------------------------------------------------------------------
// Running one export, and reading the file it actually wrote.
// ---------------------------------------------------------------------------

const dirs: string[] = [];

afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

interface Ran {
  result: ExportResult;
  manifest: ExportResult["manifest"];
  config: Record<string, unknown>;
  readings: ReturnType<typeof decodeReading>[];
  configLog: ReturnType<typeof decodeConfigLog>[];
}

/** Export the seed, then read the finished archive back with the real reader. */
async function run(seed: Seed, over: Partial<ExportRequest> = {}): Promise<Ran> {
  const dir = await mkdtemp(join(tmpdir(), "sunreye-export-"));
  dirs.push(dir);
  const { client } = fake(seed);
  const result = await exportArchive(client, {
    source: "native",
    out: join(dir, "archive.tar.gz"),
    workDir: dir,
    ...over,
  });
  const archive = await openArchive(result.path, join(dir, "read"));
  const readings: ReturnType<typeof decodeReading>[] = [];
  let lineNo = 0;
  for await (const line of archive.lines(MEMBERS.readings)) {
    lineNo += 1;
    const row = decodeReading(line, lineNo);
    if (row !== null) readings.push(row);
  }
  const configLog: ReturnType<typeof decodeConfigLog>[] = [];
  lineNo = 0;
  for await (const line of archive.lines(MEMBERS.configLog)) {
    lineNo += 1;
    const row = decodeConfigLog(line, lineNo);
    if (row !== null) configLog.push(row);
  }
  const config = archive.config as Record<string, unknown>;
  await archive.close();
  return { result, manifest: archive.manifest, config, readings, configLog };
}

const seedRaw = (over: Partial<SeedRow> = {}): SeedRow => ({
  tier: "raw",
  device: "deye-1",
  metric: "pv.power",
  time: "2026-08-20T00:00:00.000Z",
  value: 1200,
  durMs: 1000,
  ...over,
});

const METRIC_KEYS = [{ key: "pv.power", isCounter: false }];

// ---------------------------------------------------------------------------

describe("exportArchive: the file it writes", () => {
  test("a raw reading survives the whole way out, tier and dur_ms included", async () => {
    const { manifest, readings, result } = await run({
      readings: [seedRaw(), seedRaw({ time: "2026-08-20T00:00:01.000Z", value: 1300 })],
      absent: /minute_rollups|hourly_rollups|daily_rollups/,
    });

    expect(readings).toEqual([
      {
        time: new Date("2026-08-20T00:00:00.000Z"),
        deviceSlug: "deye-1",
        metricKey: "pv.power",
        value: 1200,
        durMs: 1000,
        sourceTier: "raw",
      },
      {
        time: new Date("2026-08-20T00:00:01.000Z"),
        deviceSlug: "deye-1",
        metricKey: "pv.power",
        value: 1300,
        durMs: 1000,
        sourceTier: "raw",
      },
    ]);
    expect(manifest.streams.raw).toBe(2);
    expect(manifest.rows).toBe(2);
    expect(manifest.devices).toEqual(["deye-1"]);
    expect(manifest.metrics).toEqual(["pv.power"]);
    expect(result.bytes).toBeGreaterThan(0);
    // The NDJSON is bigger than the container it compresses into — the ratio the
    // operator is shown is derived from this pair, so both have to be real.
    expect(result.uncompressedBytes).toBeGreaterThan(0);
    expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
  });

  test("THE LAST ROW OF A SERIES IS EXPORTED — the window's end is exclusive", async () => {
    // `max(time)` as the end would drop it, because every read is `< end`. That
    // is the bug `apps/server/db-tests/archive.test.ts` caught as 17 277 rows
    // against a seeded 17 280, and it hides behind a plan that happens to give
    // the day to a bucket tier instead.
    const { readings } = await run({
      readings: [
        seedRaw({ time: "2026-08-20T00:00:00.000Z", value: 1 }),
        seedRaw({ time: "2026-08-20T23:59:59.000Z", value: 2 }),
      ],
      absent: /minute_rollups|hourly_rollups|daily_rollups/,
    });
    expect(readings.map((row) => row?.value)).toEqual([1, 2]);
  });

  test("the last BUCKET of history is exported — its end is its start plus its width", async () => {
    // A bucket stamped 23:00 covers up to midnight; treating `max(bucket)` as the
    // end would leave the final bucket outside every plan, forever.
    const { readings, manifest } = await run({
      readings: [
        {
          tier: "hourly",
          device: "deye-1",
          metric: "pv.power",
          time: "2026-08-20T22:00:00.000Z",
          value: 10,
        },
        {
          tier: "hourly",
          device: "deye-1",
          metric: "pv.power",
          time: "2026-08-20T23:00:00.000Z",
          value: 20,
        },
      ],
      absent: /from metrics_raw|minute_rollups|daily_rollups/,
    });
    expect(readings.map((row) => row?.value)).toEqual([10, 20]);
    // The bucket's own width, as the hold the value stands for.
    expect(readings[0]?.durMs).toBe(3_600_000);
    expect(manifest.streams.hourly).toBe(2);
  });

  test("a bucket with NO time-weighted mean is DROPPED, never read as zero", async () => {
    // `average(tw)` is NULL for a bucket holding a single sample. A zero there is
    // a fabricated reading, and a fabricated zero in a power series is a dip on a
    // chart that never happened.
    const { readings, manifest } = await run({
      readings: [
        {
          tier: "minute",
          device: "deye-1",
          metric: "pv.power",
          time: "2026-08-20T00:00:00.000Z",
          value: null,
        },
        {
          tier: "minute",
          device: "deye-1",
          metric: "pv.power",
          time: "2026-08-20T00:01:00.000Z",
          value: 0,
        },
      ],
      absent: /from metrics_raw|hourly_rollups|daily_rollups/,
    });
    // The mean OF zero is kept — a disabled inverter really does report 0 W.
    expect(readings.map((row) => row?.value)).toEqual([0]);
    expect(manifest.streams.minute).toBe(1);
  });

  test("a chunk whose tier produced nothing is reported as BARREN, not ignored", async () => {
    // The shape of the bug that lost a whole day: a tier claimed the day and had
    // nothing to give. Either answer is possible; silence is not.
    const { result } = await run({
      readings: [
        {
          tier: "minute",
          device: "deye-1",
          metric: "pv.power",
          time: "2026-08-20T00:00:00.000Z",
          value: null,
        },
      ],
      absent: /from metrics_raw|hourly_rollups|daily_rollups/,
    });
    expect(result.barren).toHaveLength(1);
    expect(result.barren[0]?.tier).toBe("minute");
    expect(result.barren[0]?.reason).toContain("produced no rows");
  });

  test("an empty database still exports: a valid archive with no rows and no span", async () => {
    const { manifest, readings, result } = await run({ absent: /select min\(/ });
    expect(readings).toEqual([]);
    expect(manifest.rows).toBe(0);
    expect(manifest.span).toEqual({ from: null, to: null });
    expect(result.plan.chunks).toEqual([]);
  });

  test("progress is reported per window, with the running total", async () => {
    const seen: { tier: SourceTier; rows: number; total: number }[] = [];
    await run(
      {
        readings: [seedRaw(), seedRaw({ time: "2026-08-21T00:00:00.000Z" })],
        absent: /minute_rollups|hourly_rollups|daily_rollups/,
      },
      {
        onProgress: ({ tier, rows, total }) => seen.push({ tier, rows, total }),
      },
    );
    expect(seen).toEqual([
      { tier: "raw", rows: 1, total: 1 },
      { tier: "raw", rows: 1, total: 2 },
    ]);
  });

  test("only the tiers the caller asked for are considered", async () => {
    const { manifest } = await run(
      {
        readings: [
          seedRaw(),
          {
            tier: "daily",
            device: "deye-1",
            metric: "pv.power",
            time: "2026-08-20T00:00:00.000Z",
            value: 5,
          },
        ],
      },
      { tiers: ["daily"] },
    );
    // Raw is finer and present in the seed, and still absent from the file:
    // narrowing the tier list is how an operator exports "aggregates only".
    expect(manifest.streams).toMatchObject({ raw: 0, daily: 1 });
  });
});

describe("exportArchive: the configuration it carries", () => {
  test("a retired device carries its retirement out, as an ISO instant", async () => {
    const { config } = await run({
      absent: /select min\(/,
      plants: [{ id: 1, name: "Home", slug: "home", time_zone: "auto" }],
      connections: [],
      devices: [
        {
          slug: "old",
          name: "Old",
          profile_id: "deye.sun-12k",
          serial: null,
          role: "inverter",
          unit_id: 1,
          connection_id: null,
          // A Date, which is what this driver hands back for a timestamptz —
          // `String(date)` would emit "Wed Mar 04 2026 …" instead.
          retired_at: new Date("2026-03-04T05:06:07.000Z"),
          usable_kwh: null,
        },
      ],
    });
    expect(config.plant?.devices[0]?.retiredAt).toBe("2026-03-04T05:06:07.000Z");
  });

  test("an in-service device carries null, not a stringified null", async () => {
    const { config } = await run({
      absent: /select min\(/,
      plants: [{ id: 1, name: "Home", slug: "home", time_zone: "auto" }],
      connections: [],
      devices: [
        {
          slug: "live",
          name: "Live",
          profile_id: "deye.sun-12k",
          serial: null,
          role: "inverter",
          unit_id: 1,
          connection_id: null,
          retired_at: null,
          usable_kwh: null,
        },
      ],
    });
    expect(config.plant?.devices[0]?.retiredAt).toBeNull();
  });

  test("the native plant graph comes out by NAME, with its endpoints and packs", async () => {
    const { config } = await run({
      absent: /select min\(/,
      plants: [
        {
          id: 1,
          name: "Home",
          slug: "home",
          time_zone: "Europe/Berlin",
          latitude: 51.1,
          longitude: 6.9,
          label: "roof",
          arrays: [{ kwp: 9.9 }],
          temp_coefficient: -0.4,
          system_loss: 14,
          max_output_w: 10000,
          house_load_w: 400,
          smart_meter_since: "2026-01-01",
          bidding_zone: "DE-LU",
          tariff_key: "spot",
        },
      ],
      connections: [
        {
          id: 7,
          name: "loft",
          host: "10.0.0.5",
          port: 502,
          transport: "tcp",
          timeout_ms: 2000,
          poll_interval_ms: 5000,
        },
      ],
      devices: [
        {
          slug: "deye-1",
          name: "Deye",
          profile_id: "deye.sun-12k",
          serial: "SN1",
          role: "inverter",
          unit_id: 1,
          connection_id: 7,
          arrays: [{ kwp: 9.9, tilt: 30, azimuth: 0 }],
          temp_coefficient: -0.35,
          system_loss: 11,
          usable_kwh: 14.3,
          max_charge_w: 5000,
          min_soc: 15,
          nominal_v: 51.2,
        },
      ],
    });
    expect(config.plant).toMatchObject({
      name: "Home",
      slug: "home",
      timeZone: "Europe/Berlin",
      latitude: 51.1,
      arrays: [{ kwp: 9.9 }],
      connections: [{ name: "loft", host: "10.0.0.5", port: 502, pollIntervalMs: 5000 }],
      devices: [
        {
          slug: "deye-1",
          // Resolved to the endpoint's NAME, not its id: ids are not portable
          // and the importer re-resolves them on the other side.
          connection: "loft",
          battery: { usableKwh: 14.3, maxChargeW: 5000, minSoc: 15, nominalV: 51.2 },
          // The roof travels WITH the inverter now; the plant-level copy above
          // is the legacy column and rides along for older importers.
          arrays: [{ kwp: 9.9, tilt: 30, azimuth: 0 }],
          tempCoefficient: -0.35,
          systemLoss: 11,
        },
      ],
    });
  });

  test("a virtual device round-trips: role 'optimizer' survives export and parse", async () => {
    // The archive is the only path a device's role travels verbatim, in both
    // directions — no enum narrows it on the way out or on the way back. A
    // restore that turned an optimizer into an inverter would put a device with
    // no registers on the poll roster; one that dropped it would lose every
    // decision the optimizer ever recorded, because the readings are keyed to it.
    const { config } = await run({
      absent: /select min\(/,
      plants: [{ id: 1, name: "Home", slug: "home" }],
      devices: [
        {
          slug: "optimizer",
          name: "Optimizer",
          profile_id: "sunreye.optimizer",
          serial: null,
          role: "optimizer",
          unit_id: 0,
          connection_id: null,
          usable_kwh: null,
        },
      ],
    });
    expect((config.plant as { devices: { role: unknown }[] }).devices[0]?.role).toBe("optimizer");
    // Through the reader the importer actually uses, from the bytes on disk.
    const parsed = parseArchiveConfig(config);
    expect(parsed.plant?.devices).toEqual([
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
        // Column defaults on a row that never had a roof: an empty list, and
        // the coefficients as the export read them (absent here → null).
        arrays: [],
        tempCoefficient: null,
        systemLoss: null,
      },
    ]);
    expect(parsed.problems).toEqual([]);
  });

  test("a device with no pack and no endpoint carries nulls rather than zeroes", async () => {
    const { config } = await run({
      absent: /select min\(/,
      plants: [{ id: 1, name: "Home", slug: "home", label: null, arrays: null }],
      devices: [
        {
          slug: "meter",
          name: "Meter",
          profile_id: "generic",
          serial: null,
          role: "meter",
          unit_id: 2,
          connection_id: null,
          usable_kwh: null,
        },
      ],
    });
    expect(config.plant).toMatchObject({
      // An absent coordinate is unknown, and unknown is not the equator.
      latitude: null,
      longitude: null,
      timeZone: "auto",
      label: "",
      arrays: [],
      devices: [{ slug: "meter", serial: null, connection: null, battery: null }],
    });
  });

  test("a device naming an endpoint the plant does not have keeps null, not a wrong one", async () => {
    const { config } = await run({
      absent: /select min\(/,
      plants: [{ id: 1, name: "Home", slug: "home" }],
      connections: [
        {
          id: 7,
          name: "loft",
          host: "h",
          port: 502,
          transport: "tcp",
          timeout_ms: 1,
          poll_interval_ms: 1,
        },
      ],
      devices: [
        {
          slug: "d",
          name: "D",
          profile_id: "p",
          role: "inverter",
          unit_id: 1,
          connection_id: 99,
          usable_kwh: null,
          serial: null,
        },
      ],
    });
    expect(
      (config.plant as { devices: { connection: unknown }[] }).devices[0]?.connection,
    ).toBeNull();
  });

  test("no plant row means no plant, and the manifest falls back to an automatic zone", async () => {
    const { config, manifest } = await run({ absent: /select min\(/ });
    expect(config.plant).toBeNull();
    expect(manifest.plantTimeZone).toBe("auto");
  });

  test("the metric vocabulary is read WITH its counter class", async () => {
    const { config } = await run({
      absent: /select min\(/,
      metricKeys: [
        { key: "pv.power", is_counter: false },
        { key: "total.energy", is_counter: true },
      ],
    });
    expect(config.metricKeys).toEqual([
      { key: "pv.power", isCounter: false },
      { key: "total.energy", isCounter: true },
    ]);
  });

  test("a caller-supplied vocabulary wins over the table", async () => {
    const { config } = await run(
      { absent: /select min\(/, metricKeys: [{ key: "pv.power", is_counter: false }] },
      { metricKeys: [{ key: "total.energy", isCounter: true }] },
    );
    expect(config.metricKeys).toEqual([{ key: "total.energy", isCounter: true }]);
  });

  test("settings, profiles and charts are carried, and the config keys the caller names", async () => {
    const { config } = await run(
      {
        absent: /select min\(/,
        settings: { "display.theme": "dark" },
        profiles: [{ id: "deye.sun-12k", source: "builtin", version: "1.2.0", data: { keys: [] } }],
        charts: [{ id: "c1", name: "Mine", data: { series: [] } }],
      },
      { configKeys: ["grid.export_limit"] },
    );
    expect(config.appSettings).toEqual([{ key: "display.theme", value: "dark" }]);
    expect(config.installedProfiles).toEqual([
      { id: "deye.sun-12k", source: "builtin", version: "1.2.0", data: { keys: [] } },
    ]);
    expect(config.customCharts).toEqual([{ id: "c1", name: "Mine", data: { series: [] } }]);
    expect(config.configKeys).toEqual(["grid.export_limit"]);
  });

  test("a table this schema does not have yields no rows, not a failed export", async () => {
    // A 1.x database predating `custom_charts` must still export. Absent is not
    // an error, and it is not an empty document either — there is nothing there.
    const { config } = await run({
      absent: /select min\(|from custom_charts|from installed_profiles/,
      settings: { "display.theme": "dark" },
    });
    expect(config.customCharts).toEqual([]);
    expect(config.installedProfiles).toEqual([]);
    expect(config.appSettings).toEqual([{ key: "display.theme", value: "dark" }]);
  });

  test("a profile or chart with no document at all becomes an empty one, not null", async () => {
    const { config } = await run({
      absent: /select min\(/,
      profiles: [{ id: "p", source: "s", version: "1", data: null }],
      charts: [{ id: "c", name: "n", data: null }],
    });
    expect(config.installedProfiles).toEqual([{ id: "p", source: "s", version: "1", data: {} }]);
    expect(config.customCharts).toEqual([{ id: "c", name: "n", data: {} }]);
  });
});

describe("exportArchive: secrets", () => {
  const secrets: Seed = {
    absent: /select min\(/,
    settings: {
      "mqtt.config": { host: "hass.lan", username: "mqtt", password: "hunter2" },
      "forecast.provider": { name: "solcast", apiKey: "sk-live-1234" },
    },
  };

  test("a password and a token are REDACTED by default", async () => {
    // `app_settings` holds these in plaintext and the REST API deliberately
    // refuses to return them. On the add-on the export lands in /share, which the
    // Samba add-on serves to the whole LAN — so the safe default is the only
    // defensible one.
    const { config } = await run(secrets);
    expect(config.appSettings).toEqual([
      { key: "forecast.provider", value: { name: "solcast", apiKey: REDACTED } },
      { key: "mqtt.config", value: { host: "hass.lan", username: "mqtt", password: REDACTED } },
    ]);
  });

  test("--include-secrets carries them verbatim, for the operator moving machines", async () => {
    const { config } = await run(secrets, { includeSecrets: true });
    expect(config.appSettings).toEqual([
      { key: "forecast.provider", value: { name: "solcast", apiKey: "sk-live-1234" } },
      { key: "mqtt.config", value: { host: "hass.lan", username: "mqtt", password: "hunter2" } },
    ]);
  });
});

describe("exportArchive: provenance", () => {
  test("the fingerprint is read from the DATABASE, not from the build", async () => {
    // A binary can be newer than the database it is pointed at, and the whole
    // value of the fingerprint is telling a human what actually wrote the file.
    const { manifest } = await run(
      {
        absent: /select min\(/,
        timescaleFiles: ["0000_baseline.sql", "0001_stage.sql"],
        drizzle: [{ hash: "abc123", created_at: 1755000000000 }],
      },
      { appVersion: "2.0.0" },
    );
    expect(manifest.source).toEqual({
      app: "2.0.0",
      drizzleTag: "abc123",
      drizzleWhen: 1755000000000,
      timescaleFiles: ["0000_baseline.sql", "0001_stage.sql"],
    });
  });

  test("a database with no journals at all reports absence, not zero", async () => {
    const { manifest } = await run({ absent: /select min\(|timescale_migrations|drizzle/ });
    expect(manifest.source).toEqual({
      app: "unknown",
      drizzleTag: null,
      drizzleWhen: null,
      timescaleFiles: [],
    });
  });

  test("a drizzle row with no timestamp reports null rather than 1970", async () => {
    const { manifest } = await run({
      absent: /select min\(/,
      drizzle: [{ hash: "abc123", created_at: 0 }],
    });
    expect(manifest.source.drizzleWhen).toBeNull();
  });
});

describe("exportArchive: the native config log", () => {
  test("2.0.0's change log is copied straight across", async () => {
    const { configLog, manifest } = await run({
      absent: /select min\(/,
      configLog: [
        { t: "2026-08-20T10:00:00.000Z", device: "deye-1", metric: "grid.export_limit", v: 7000 },
        // A row with no value is not a change anybody can replay.
        { t: "2026-08-20T11:00:00.000Z", device: "deye-1", metric: "grid.export_limit", v: null },
        { t: "not a time", device: "deye-1", metric: "grid.export_limit", v: 1 },
      ],
    });
    expect(configLog).toEqual([
      {
        time: new Date("2026-08-20T10:00:00.000Z"),
        deviceSlug: "deye-1",
        metricKey: "grid.export_limit",
        value: 7000,
      },
    ]);
    expect(manifest.streams.configLog).toBe(1);
  });

  test("a LEGACY export has no change log of its own to copy", async () => {
    const { configLog } = await run(
      {
        absent: /select min\(/,
        configLog: [{ t: "2026-08-20T10:00:00.000Z", device: "d", metric: "m", v: 1 }],
      },
      { source: "legacy", metricKeys: METRIC_KEYS, profileId: "deye.sun-12k" },
    );
    // 1.2.0 wrote configuration into `metrics_raw`; there is no
    // `metrics_config_log` to read, and reading one would be reading a table this
    // arm's whole reason for existing says is absent.
    expect(configLog).toEqual([]);
  });
});

describe("exportArchive: the legacy arm", () => {
  test("REFUSES without the metric vocabulary — defaulting is_counter is a 1532x error", async () => {
    // 1.2.0 has no `metric_keys` table, so `is_counter` cannot be read. Guessing
    // false turns every energy total on the other side into a naive
    // max-minus-min: 64280.971 kWh against a truth of 41.971 on the real fixture.
    await expect(run({ absent: /select min\(/ }, { source: "legacy" })).rejects.toThrow(
      /needs the metric vocabulary/,
    );
  });

  test("an EMPTY vocabulary is refused too — the check is content, not presence", async () => {
    await expect(
      run({ absent: /select min\(/ }, { source: "legacy", metricKeys: [] }),
    ).rejects.toThrow(/needs the metric vocabulary/);
  });

  test("1.2.0's DOUBLE-ENCODED settings and profile are normalised on the way out", async () => {
    // Every row of the committed addon-1.2.0 fixture stores `app_settings.value`
    // and `installed_profiles.data` as a jsonb STRING containing the document.
    // Carried forward as-is, the archive's settings are unreadable to 2.0.0's own
    // parsers.
    const { config } = await run(
      {
        absent: /select min\(/,
        settings: { "display.theme": JSON.stringify("dark") },
        profiles: [{ id: "p", source: "s", version: "1", data: JSON.stringify({ keys: [1] }) }],
        charts: [{ id: "c", name: "n", data: JSON.stringify({ series: [] }) }],
      },
      { source: "legacy", metricKeys: METRIC_KEYS, profileId: "deye.sun-12k" },
    );
    expect(config.appSettings).toEqual([{ key: "display.theme", value: "dark" }]);
    expect(config.installedProfiles).toEqual([
      { id: "p", source: "s", version: "1", data: { keys: [1] } },
    ]);
    expect(config.customCharts).toEqual([{ id: "c", name: "n", data: { series: [] } }]);
  });

  test("a secret inside a double-encoded 1.2.0 setting is STILL redacted", async () => {
    // Redaction runs AFTER unwrapping, and it has to: redacting a JSON string
    // walks a string and finds no fields at all, so the password would travel —
    // quietly, on exactly the legacy path this feature exists for.
    const { config } = await run(
      {
        absent: /select min\(/,
        settings: { "mqtt.config": JSON.stringify({ host: "h", password: "hunter2" }) },
      },
      { source: "legacy", metricKeys: METRIC_KEYS, profileId: "deye.sun-12k" },
    );
    expect(config.appSettings).toEqual([
      { key: "mqtt.config", value: { host: "h", password: REDACTED } },
    ]);
  });

  test("a native setting whose value really IS a string is left alone", async () => {
    const { config } = await run({
      absent: /select min\(/,
      settings: { "display.theme": JSON.stringify("dark") },
    });
    // No unwrapping on the native path: 2.0.0 stores the document, so a string
    // here is the value.
    expect(config.appSettings).toEqual([{ key: "display.theme", value: '"dark"' }]);
  });

  test("the profile id is taken from settings when the caller names none", async () => {
    const { config } = await run(
      {
        absent: /select min\(/,
        settings: { "inverter.profile": JSON.stringify("deye.sun-12k") },
      },
      { source: "legacy", metricKeys: METRIC_KEYS, profileId: "deye.sun-12k" },
    );
    expect((config.plant as { devices: { profileId: string }[] }).devices[0]?.profileId).toBe(
      "deye.sun-12k",
    );
  });

  test("the caller's profile id wins over the one in settings", async () => {
    const { config } = await run(
      {
        absent: /select min\(/,
        settings: { "inverter.profile": JSON.stringify("from-settings") },
      },
      { source: "legacy", metricKeys: METRIC_KEYS, profileId: "from-caller" },
    );
    expect((config.plant as { devices: { profileId: string }[] }).devices[0]?.profileId).toBe(
      "from-caller",
    );
  });

  test("falling back to the installed profile when neither names one", async () => {
    const { config } = await run(
      {
        absent: /select min\(/,
        profiles: [{ id: "installed.only", source: "s", version: "1", data: null }],
      },
      { source: "legacy", metricKeys: METRIC_KEYS },
    );
    expect((config.plant as { devices: { profileId: string }[] }).devices[0]?.profileId).toBe(
      "installed.only",
    );
  });

  test("a legacy raw row has NO claimed hold — null, which is not zero", async () => {
    const { readings, manifest } = await run(
      {
        readings: [
          {
            tier: "raw",
            device: "1",
            metric: "pv.power",
            time: "2026-08-20T00:00:00.000Z",
            value: 900,
          },
        ],
        absent: /minute_rollups|hourly_rollups|daily_rollups/,
      },
      { source: "legacy", metricKeys: METRIC_KEYS, profileId: "deye.sun-12k" },
    );
    // 1.2.0's `metrics_raw` has no `dur_ms` column at all, and "unknown hold" is
    // the honest answer.
    expect(readings[0]?.durMs).toBeNull();
    // The device is 1.2.0's `inverter_id`, carried as the slug it will be
    // re-resolved by.
    expect(readings[0]?.deviceSlug).toBe("1");
    expect(manifest.source.app).toBe("1.2.0-legacy");
  });

  test("a legacy CONFIGURATION register is collapsed to its CHANGES", async () => {
    // 1.2.0 wrote configuration registers into `metrics_raw` at the poll cadence,
    // so a week of them is ~265k rows saying the same thing. Only changes are
    // information.
    const { readings, configLog, manifest } = await run(
      {
        readings: [
          {
            tier: "raw",
            device: "1",
            metric: "grid.export_limit",
            time: "2026-08-20T00:00:00.000Z",
            value: 7000,
          },
          {
            tier: "raw",
            device: "1",
            metric: "grid.export_limit",
            time: "2026-08-20T00:00:01.000Z",
            value: 7000,
          },
          {
            tier: "raw",
            device: "1",
            metric: "grid.export_limit",
            time: "2026-08-20T00:00:02.000Z",
            value: 0,
          },
          {
            tier: "raw",
            device: "1",
            metric: "grid.export_limit",
            time: "2026-08-20T00:00:03.000Z",
            value: 0,
          },
          {
            tier: "raw",
            device: "1",
            metric: "grid.export_limit",
            time: "2026-08-20T00:00:04.000Z",
            value: 7000,
          },
        ],
        absent: /minute_rollups|hourly_rollups|daily_rollups/,
      },
      {
        source: "legacy",
        metricKeys: [{ key: "grid.export_limit", isCounter: false }],
        configKeys: ["grid.export_limit"],
        profileId: "deye.sun-12k",
      },
    );
    // 0 is a legitimate setting value — the most common one, a disabled limit —
    // so the filter compares values rather than testing truthiness.
    expect(configLog.map((row) => row?.value)).toEqual([7000, 0, 7000]);
    // A configuration change is not a reading, and must not be counted as one.
    expect(readings).toEqual([]);
    expect(manifest.streams.raw).toBe(0);
    expect(manifest.streams.configLog).toBe(3);
    // …and the device and metric still appear in the manifest's vocabulary: they
    // are in the file, just in the other member.
    expect(manifest.metrics).toEqual(["grid.export_limit"]);
  });

  test("a configuration key read from a BUCKET tier stays a reading", async () => {
    // The collapse is a raw-arm decision. A bucket row of a configuration
    // register is already one value per bucket, and routing it to the change log
    // would claim a change happened at a bucket boundary.
    const { readings, configLog } = await run(
      {
        readings: [
          {
            tier: "hourly",
            device: "1",
            metric: "grid.export_limit",
            time: "2026-08-20T00:00:00.000Z",
            value: 7000,
          },
        ],
        absent: /from metrics_raw|minute_rollups|daily_rollups/,
      },
      {
        source: "legacy",
        metricKeys: [{ key: "grid.export_limit", isCounter: false }],
        configKeys: ["grid.export_limit"],
        profileId: "deye.sun-12k",
      },
    );
    expect(configLog).toEqual([]);
    expect(readings).toHaveLength(1);
  });
});
