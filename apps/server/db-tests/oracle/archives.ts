/**
 * Oracle group 5 — archives.
 *
 * Two archives are assembled with the 2.x writer (`buildManifest`, `writeArchive`, `synthesiseSpine`)
 * and imported by the 2.x importer into `sunreye_dbtest`; the committed result is what landed.
 * They are assembled from authored rows rather than exported, because `exportArchive` walks the
 * first plant of whatever database it is given and this one is shared with other specs.
 */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

import { sql } from "drizzle-orm";

import {
  type ConfigLogRow,
  type ReadingRow,
  type SourceFingerprint,
  type SourceTier,
  buildManifest,
  encodeConfigLog,
  encodeReading,
  emptyStreamCounts,
} from "@SunReye/db/archive";
import { synthesiseSpine } from "@SunReye/db/archive-config";
import { writeArchive } from "@SunReye/db/archive-file";
import { importArchive } from "@SunReye/db/archive-import";
import { automationConfigSchema } from "@SunReye/db/automation-config";
import { perDayEnergy } from "@SunReye/db/counter-energy";
import { productionRuntime } from "@SunReye/db/migrate";
import type { ReplayClient } from "@SunReye/db/replay-run";

import { type Db, type Files } from "./files";

interface ArchiveSpec {
  id: string;
  doc: string;
  source: SourceFingerprint;
  plantTimeZone: string;
  config: Record<string, unknown>;
  readings: ReadingRow[];
  configLog: ConfigLogRow[];
  /** What the import is read back by: everything else in the database is another spec's. */
  scope: { plant: string; settings: string[]; profiles: string[]; metrics: string[] };
}

const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

const row = (
  tier: SourceTier,
  device: string,
  metric: string,
  time: string,
  value: number,
  durMs: number,
): ReadingRow => ({
  time: new Date(time),
  deviceSlug: device,
  metricKey: metric,
  value,
  durMs,
  sourceTier: tier,
});

// ---------------------------------------------------------------------------
// The current (2.x) archive

const CURRENT_DEVICE = "oracle-archive-inverter";
const POWER = "oracle.archive.power";
const ENERGY = "oracle.archive.energy.total";
const LIMIT = "oracle.archive.settings.max_charge_current";

/** The automations config with peak shaving on, every other field at its schema default. */
const automations = automationConfigSchema.parse({
  enabled: true,
  peakShaving: { enabled: true, mode: "grid-friendly", gridFriendly: { minThresholdW: 200 } },
});

function currentReadings(): ReadingRow[] {
  const at = (iso: string, ...values: [string, number][]) =>
    values.map(([m, v]) => [iso, m, v] as const);
  const rows: ReadingRow[] = [];
  const add = (tier: SourceTier, durMs: number, entries: ReturnType<typeof at>) =>
    entries.forEach(([time, metric, value]) =>
      rows.push(row(tier, CURRENT_DEVICE, metric, time, value, durMs)),
    );
  add("daily", DAY, at("2026-04-28T00:00:00Z", [POWER, 400], [ENERGY, 4950]));
  add("daily", DAY, at("2026-04-29T00:00:00Z", [POWER, 500], [ENERGY, 4970]));
  add("hourly", HOUR, at("2026-04-30T10:00:00Z", [POWER, 800], [ENERGY, 4990]));
  add("hourly", HOUR, at("2026-04-30T11:00:00Z", [POWER, 1200], [ENERGY, 4991.5]));
  add("raw", 10 * MIN, at("2026-05-01T12:00:00Z", [POWER, 1000], [ENERGY, 5000]));
  add("raw", 10 * MIN, at("2026-05-01T12:10:00Z", [POWER, 2000], [ENERGY, 5000.2]));
  add("raw", 10 * MIN, at("2026-05-01T12:20:00Z", [POWER, 0], [ENERGY, 5000.3]));
  return rows;
}

const CURRENT: ArchiveSpec = {
  id: "current-2.x",
  doc: "a 2.x export of a plant with a battery, a Solarman endpoint, automation enabled and its held register value; daily, hourly and raw history",
  source: {
    app: "2.0.0-oracle",
    drizzleTag: "0008_bind_evcc_ingest",
    drizzleWhen: 1_790_000_000_000,
    timescaleFiles: ["0000_baseline.sql"],
  },
  plantTimeZone: "Europe/Berlin",
  config: {
    plant: {
      name: "Oracle archive plant",
      slug: "oracle-archive",
      timeZone: "Europe/Berlin",
      latitude: 50.4,
      longitude: 8.3,
      label: "Limburg-Weilburg",
      arrays: [],
      tempCoefficient: -0.4,
      systemLoss: 14,
      maxOutputW: 8000,
      houseLoadW: 500,
      smartMeterSince: null,
      biddingZone: "DE-LU",
      tariffKey: null,
      connections: [
        {
          name: "Gateway",
          kind: "modbus",
          params: {
            host: "10.20.0.62",
            port: 8899,
            transport: "solarman-v5",
            timeoutMs: 3000,
            pollIntervalMs: 2000,
          },
        },
      ],
      devices: [
        {
          slug: CURRENT_DEVICE,
          name: "Inverter",
          profileId: "deye-sg05lp3",
          serial: null,
          role: "inverter",
          unitId: 1,
          connection: "Gateway",
          retiredAt: null,
          battery: { usableKwh: 10, maxChargeW: 5000, minSoc: 10, nominalV: 51.2 },
          arrays: [],
          tempCoefficient: -0.4,
          systemLoss: 14,
        },
      ],
    },
    appSettings: [
      { key: "automations", value: automations },
      {
        key: "automationState",
        value: { "1:peak-shaving": { previousValue: 60, capturedAt: "2026-05-01T10:00:00.000Z" } },
      },
    ],
    installedProfiles: [],
    customCharts: [],
    metricKeys: [
      { key: POWER, isCounter: false },
      { key: ENERGY, isCounter: true },
      { key: LIMIT, isCounter: false },
    ],
    configKeys: [LIMIT],
  },
  readings: currentReadings(),
  configLog: [
    {
      time: new Date("2026-04-30T06:00:00Z"),
      deviceSlug: CURRENT_DEVICE,
      metricKey: LIMIT,
      value: 60,
    },
    {
      time: new Date("2026-05-01T09:30:00Z"),
      deviceSlug: CURRENT_DEVICE,
      metricKey: LIMIT,
      value: 40,
    },
  ],
  scope: {
    plant: "oracle-archive",
    settings: ["automations", "automationState"],
    profiles: [],
    metrics: [POWER, ENERGY, LIMIT],
  },
};

// ---------------------------------------------------------------------------
// The 1.2.0-era archive

const LEGACY_PROFILE = "oracle-legacy-profile";
const L_POWER = "oracle.legacy.power";
const L_ENERGY = "oracle.legacy.energy.total";

const legacySettings = new Map<string, unknown>([
  ["inverter", { host: "192.168.1.50", port: 502, unitId: 1 }],
  ["weather", { label: "Limburg-Weilburg", latitude: 50.4, longitude: 8.3 }],
  // A real 1.x plant document names no slug; this one does, so the import cannot touch another plant.
  ["plant", { timeZone: "Europe/Berlin", slug: "oracle-legacy" }],
]);

function legacyReadings(): ReadingRow[] {
  const rows: ReadingRow[] = [];
  const add = (
    tier: SourceTier,
    durMs: number,
    time: string,
    power: number | null,
    energy: number,
  ) => {
    if (power !== null) rows.push(row(tier, LEGACY_PROFILE, L_POWER, time, power, durMs));
    rows.push(row(tier, LEGACY_PROFILE, L_ENERGY, time, energy, durMs));
  };
  add("daily", DAY, "2026-02-06T00:00:00Z", 280, 40850);
  add("daily", DAY, "2026-02-07T00:00:00Z", 300, 40900);
  add("daily", DAY, "2026-02-08T00:00:00Z", 350, 40950);
  // One whole UTC day of hourly buckets: a tier replays only the days it covers completely.
  for (let hour = 0; hour < 24; hour++) {
    const time = new Date(Date.UTC(2026, 1, 9, hour)).toISOString();
    add("hourly", HOUR, time, null, Math.round((40990 + hour / 10) * 10) / 10);
  }
  // Three minutes of a day that no tier covers: reported as a gap, not replayed.
  add("minute", MIN, "2026-02-10T08:00:00Z", 1500, 41000.2);
  add("minute", MIN, "2026-02-10T08:01:00Z", 1600, 41000.6);
  add("minute", MIN, "2026-02-10T08:02:00Z", 1550, 41000.7);
  // The lifetime counter loses its total inside this raw day.
  add("raw", MIN, "2026-02-11T09:00:00Z", 700, 41000.2);
  add("raw", MIN, "2026-02-11T09:10:00Z", 800, 41000.6);
  add("raw", MIN, "2026-02-11T09:20:00Z", 750, 0.1);
  add("raw", MIN, "2026-02-11T09:30:00Z", 900, 0.5);
  return rows;
}

const LEGACY: ArchiveSpec = {
  id: "legacy-1.2.0",
  doc: "what a 2.x export writes from an addon-1.2.0 database: a spine synthesised from 1.x settings, one device named by its profile id, minute, hourly and daily buckets plus the retained raw days",
  source: { app: "1.2.0-legacy", drizzleTag: null, drizzleWhen: null, timescaleFiles: [] },
  plantTimeZone: "Europe/Berlin",
  config: {
    plant: synthesiseSpine({ settings: legacySettings, profileId: LEGACY_PROFILE, legacy: true }),
    appSettings: [...legacySettings].map(([key, value]) => ({ key, value })),
    installedProfiles: [
      {
        id: LEGACY_PROFILE,
        source: "repo",
        version: "1.0.17",
        data: { id: LEGACY_PROFILE, name: "Oracle legacy" },
      },
    ],
    customCharts: [],
    metricKeys: [
      { key: L_POWER, isCounter: false },
      { key: L_ENERGY, isCounter: true },
    ],
    configKeys: [],
  },
  readings: legacyReadings(),
  configLog: [],
  scope: {
    plant: "oracle-legacy",
    settings: ["inverter", "weather", "plant"],
    profiles: [LEGACY_PROFILE],
    metrics: [L_POWER, L_ENERGY],
  },
};

// ---------------------------------------------------------------------------
// Assembly, import and read-back

const text = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;
const gz = (lines: string[]): Uint8Array => gzipSync(lines.map((l) => `${l}\n`).join(""));

/** The real container, plus its members as readable text. */
async function pack(spec: ArchiveSpec, out: string) {
  const streams = emptyStreamCounts();
  for (const r of spec.readings) streams[r.sourceTier] += 1;
  streams.configLog = spec.configLog.length;
  const times = spec.readings.map((r) => r.time.getTime());
  const manifest = buildManifest({
    createdAt: new Date("2026-05-02T00:00:00Z"),
    source: spec.source,
    plantTimeZone: spec.plantTimeZone,
    streams,
    span: { from: new Date(Math.min(...times)), to: new Date(Math.max(...times)) },
    // The exporter lists every series it wrote, configuration registers included.
    devices: [...new Set([...spec.readings, ...spec.configLog].map((r) => r.deviceSlug))].sort(),
    metrics: [...new Set([...spec.readings, ...spec.configLog].map((r) => r.metricKey))].sort(),
  });
  const readings = spec.readings.map(encodeReading);
  const configLog = spec.configLog.map(encodeConfigLog);
  await writeArchive(out, [
    { name: "manifest.json", bytes: Buffer.from(text(manifest)) },
    { name: "config.json", bytes: Buffer.from(text(spec.config)) },
    { name: "config-log.ndjson.gz", bytes: gz(configLog) },
    { name: "readings.ndjson.gz", bytes: gz(readings) },
  ]);
  return {
    manifest: text(manifest),
    config: text(spec.config),
    configLog: configLog.map((l) => `${l}\n`).join(""),
    readings: readings.map((l) => `${l}\n`).join(""),
  };
}

type Rows = Record<string, unknown>[];
const rowsOf = async (db: Db, query: ReturnType<typeof sql>): Promise<Rows> =>
  (await db.execute(query)).rows as Rows;

const list = (values: readonly string[]) =>
  sql.join(
    values.map((v) => sql`${v}`),
    sql`, `,
  );

async function readBack(db: Db, spec: ArchiveSpec) {
  const { plant, settings, profiles, metrics } = spec.scope;
  const metricList = list(metrics);
  const raw = await rowsOf(
    db,
    sql`select d.slug as device, mk.key as metric, r.time, r.value, r.dur_ms
        from metrics_raw r
        join devices d on d.id = r.device_id join metric_keys mk on mk.id = r.metric_id
        join plants p on p.id = d.plant_id
        where p.slug = ${plant} and mk.key in (${metricList})
        order by mk.key, r.time`,
  );
  const settingRows = settings.length
    ? await rowsOf(
        db,
        sql`select key, value from app_settings where key in (${list(settings)}) order by key`,
      )
    : [];
  return {
    plant: (
      await rowsOf(
        db,
        sql`select name, slug, time_zone, latitude, longitude, label, max_output_w, house_load_w,
                   bidding_zone, temp_coefficient, system_loss
            from plants where slug = ${plant}`,
      )
    )[0],
    connections: await rowsOf(
      db,
      sql`select c.name, c.kind, c.params from connections c join plants p on p.id = c.plant_id
          where p.slug = ${plant} order by c.name`,
    ),
    devices: await rowsOf(
      db,
      sql`select d.slug, d.name, d.profile_id, d.role, d.unit_id, d.serial, d.retired_at,
                 c.name as connection, b.usable_kwh, b.max_charge_w, b.min_soc, b.nominal_v
          from devices d join plants p on p.id = d.plant_id
          left join connections c on c.id = d.connection_id
          left join batteries b on b.device_id = d.id
          where p.slug = ${plant} order by d.slug`,
    ),
    settings: Object.fromEntries(settingRows.map((s) => [s.key as string, s.value])),
    installedProfiles: profiles.length
      ? await rowsOf(
          db,
          sql`select id, source, version, data from installed_profiles where id in (${list(profiles)}) order by id`,
        )
      : [],
    metricKeys: await rowsOf(
      db,
      sql`select key, is_counter from metric_keys where key in (${metricList}) order by key`,
    ),
    raw: raw.map((r) => ({ ...r, time: new Date(r.time as string).toISOString() })),
    energyPerDay: perDayEnergy(
      raw.map((r) => ({
        metric: r.metric as string,
        time: new Date(r.time as string).toISOString(),
        value: Number(r.value),
      })),
    ),
    configLog: (
      await rowsOf(
        db,
        sql`select mk.key as metric, l.time, l.value from metrics_config_log l
            join metric_keys mk on mk.id = l.metric_id where mk.key in (${metricList})
            order by mk.key, l.time`,
      )
    ).map((r) => ({ ...r, time: new Date(r.time as string).toISOString() })),
  };
}

/** The app_settings rows an import is about to overwrite, so they can be put back. */
async function snapshotSettings(db: Db, keys: string[]): Promise<Rows> {
  return keys.length
    ? rowsOf(db, sql`select key, value from app_settings where key in (${list(keys)})`)
    : [];
}

async function restoreSettings(db: Db, keys: string[], before: Rows): Promise<void> {
  for (const key of keys) {
    const previous = before.find((r) => r.key === key);
    await db.execute(
      previous
        ? sql`update app_settings set value = ${JSON.stringify(previous.value)}::jsonb where key = ${key}`
        : sql`delete from app_settings where key = ${key}`,
    );
  }
}

async function importOne(db: Db, url: string, spec: ArchiveSpec, dir: string): Promise<Files> {
  const archive = join(dir, `${spec.id}.tar.gz`);
  const members = await pack(spec, archive);
  // The client the `sunreye import` command builds: node-postgres, so `$n::jsonb` stores a document
  // rather than a string holding one.
  const client = productionRuntime.createClient(url);
  await client.connect();
  const before = await snapshotSettings(db, spec.scope.settings);
  try {
    const imported = await importArchive(client as unknown as ReplayClient, {
      file: archive,
      workDir: join(dir, `${spec.id}.work`),
    });
    const landed = await readBack(db, spec);
    const expected = {
      archive: spec.id,
      doc: spec.doc,
      result: {
        skipped: imported.skipped,
        inserted: imported.inserted,
        replays: imported.replays.map((r) => ({
          seriesRows: r.seriesRows,
          configRows: r.configRows,
          gaps: r.gaps,
        })),
        problems: imported.problems,
      },
      ...landed,
    };
    const base = `archives/${spec.id}/`;
    return {
      [`${base}archive.tar.gz`]: new Uint8Array(await readFile(archive)),
      [`${base}manifest.json`]: members.manifest,
      [`${base}config.json`]: members.config,
      [`${base}config-log.ndjson`]: members.configLog,
      [`${base}readings.ndjson`]: members.readings,
      [`${base}expected-import.json`]: text(expected),
    };
  } finally {
    await restoreSettings(db, spec.scope.settings, before);
    await client.end();
  }
}

/** Build every file of `archives/`. */
export async function buildArchives(db: Db, url: string): Promise<Files> {
  const dir = await mkdtemp(join(tmpdir(), "sunreye-oracle-archives-"));
  try {
    return {
      ...(await importOne(db, url, CURRENT, dir)),
      ...(await importOne(db, url, LEGACY, dir)),
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
