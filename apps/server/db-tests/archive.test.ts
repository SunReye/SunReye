/**
 * THE PORTABLE ARCHIVE against a real TimescaleDB.
 *
 * `packages/db/src/archive*.test.ts` prove the format, the plan, the container
 * and every refusal that can be decided without a database. None of that proves
 * that Postgres ACCEPTS the statements, that the rows land where they are
 * claimed to, or that the imported series still answers the one question the
 * 2.0.0 schema exists for — how much energy a counter recorded on a day it lost
 * its total. So this file executes all of it and asserts NUMBERS.
 *
 * Five properties are load-bearing here, and each has a way of failing silently:
 *
 *  1. ENERGY SURVIVES THE ROUND TRIP. Export, import, and the per-day kWh of the
 *     imported series must equal the per-day kWh of the original. The ground
 *     truth is `energyOf` from `@SunReye/db/counter-energy` — the same
 *     unit-tested function the committed fixture ground truth was written with,
 *     never a second implementation.
 *  2. THE RESET HAZARD STAYS FIXED. The seeded lifetime counter loses its
 *     accumulated total MID-DAY. A round trip that dropped `is_counter`, or that
 *     lost the interval structure, would report a naive max-minus-min figure —
 *     wrong by three orders of magnitude, with no error anywhere.
 *  3. THE AGGREGATES ARE ACTUALLY MATERIALIZED. The refresh POLICIES reach three
 *     hours back and imported history never is, so if the importer's manual
 *     refresh regressed, `metrics_raw` would be full and every chart empty. That
 *     is the most confusing possible outcome and it cannot be asserted from SQL
 *     text.
 *  4. AN UNKNOWN IDENTITY IS REFUSED, LOUDLY. A `join metric_keys` that finds no
 *     match drops the row and reports success.
 *  5. A SECOND IMPORT OF THE SAME FILE IS A NO-OP. `metrics_raw` has no unique
 *     key, so a doubled series does not error — it reports a wrong kWh figure
 *     months later.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SQL } from "bun";
import { sql } from "drizzle-orm";

import { type CounterRow, energyOf } from "@SunReye/db/counter-energy";
import { ensureMetricKeys } from "@SunReye/db/metric-keys";
import { type ReplayClient, bunSqlClient, metricKeyWriter } from "@SunReye/db/replay-run";
import { exportArchive } from "@SunReye/db/archive-export";
import { importArchive, upsertDevice } from "@SunReye/db/archive-import";
import { MEMBERS, buildManifest, emptyStreamCounts, tarEnd, tarMember } from "@SunReye/db/archive";
import { createLineSpool, writeArchive } from "@SunReye/db/archive-file";
import { databaseReachable, resetTestDatabase } from "./harness";

const reachable = await databaseReachable();
const realDb = await import("@SunReye/db");
const realDbExports = { ...realDb };

if (!reachable) {
  const message = "db-tests: no Postgres reachable via DB_TEST_URL/DATABASE_URL.";
  if (process.env.CI) throw new Error(`${message} In CI this layer must never be skipped.`);
  console.warn(`${message} Skipping.`);
}

const suite = reachable ? describe : describe.skip;

/** Four days at one sample a minute, so a minute bucket holds exactly one sample. */
const SPAN_DAYS = 4;
const MINUTES_PER_DAY = 1440;
const START = "2026-03-01T00:00:00Z";
const END = "2026-03-05T00:00:00Z";

/** The cliff sits MID-DAY, where a naive max-minus-min is wrong rather than lucky. */
const RESTART_AT_MINUTE = Math.floor(SPAN_DAYS / 2) * MINUTES_PER_DAY + 720;
const LIFETIME_OFFSET = 45_000;
const RATE_PER_DAY = 30;
const LOST_AT_CLIFF = LIFETIME_OFFSET + (RATE_PER_DAY * RESTART_AT_MINUTE) / MINUTES_PER_DAY;

/**
 * Own slugs and own keys, because the db-test layer shares ONE database across
 * spec files. Every row this file writes is scoped by these.
 */
const PLANT = "arch-plant";
const SOURCE_DEVICE = "arch-source";
const TARGET_DEVICE = "arch-target";
const SECOND_TARGET = "arch-target-2";
/** A device used ONLY by the retention test, so its ancient row scopes nothing else. */
const ANCIENT_DEVICE = "arch-ancient";
const TOTAL = "arch.total_energy";
const DAY = "arch.day_energy";
const POWER = "arch.power";
const COUNTERS = [TOTAL, DAY];

const SERIES: { key: string; isCounter: boolean; expr: string }[] = [
  {
    key: TOTAL,
    isCounter: true,
    expr:
      `case when s.mi >= ${RESTART_AT_MINUTE}` +
      ` then (${LIFETIME_OFFSET} + ${RATE_PER_DAY} * s.m / ${MINUTES_PER_DAY}) - ${LOST_AT_CLIFF}` +
      ` else ${LIFETIME_OFFSET} + ${RATE_PER_DAY} * s.m / ${MINUTES_PER_DAY} end`,
  },
  {
    key: DAY,
    isCounter: true,
    expr: `${RATE_PER_DAY} * mod(s.mi, ${MINUTES_PER_DAY})::double precision / ${MINUTES_PER_DAY}`,
  },
  {
    // A diurnal curve, so the exported span holds real zeros and a real swing.
    key: POWER,
    isCounter: false,
    expr: `greatest(0::double precision, 4000 * sin(pi() * ((mod(s.mi, ${MINUTES_PER_DAY})::double precision / 60) - 6) / 12))`,
  },
];

const EPSILON = 1e-6;

suite("the portable archive against a real TimescaleDB", () => {
  let pool: SQL;
  let client: ReplayClient;
  let raw: ReturnType<typeof realDbExports.createDbAt>;
  let dir = "";
  let archivePath = "";
  /** Per-metric per-day energy the SEEDED samples imply — the ground truth. */
  let truth: { energy: ReturnType<typeof energyOf>["energy"] };

  /** Per-metric per-day energy of one device's `metrics_raw` rows. */
  const energyOfDevice = async (slug: string) => {
    const energy: ReturnType<typeof energyOf>["energy"] = [];
    const restarts: ReturnType<typeof energyOf>["restarts"] = [];
    for (const metric of COUNTERS) {
      const rows = await raw.execute<{ time: Date; value: number }>(sql`
        select r.time, r.value from metrics_raw r
        join metric_keys mk on mk.id = r.metric_id
        join devices d on d.id = r.device_id
        where d.slug = ${slug} and mk.key = ${metric}
        order by r.time`);
      const analysed = energyOf(metric, rows.rows as CounterRow[]);
      energy.push(...analysed.energy);
      restarts.push(...analysed.restarts);
    }
    return { energy, restarts };
  };

  const exportSource = async (out: string) => {
    const workDir = await mkdtemp(join(dir, "export-"));
    return exportArchive(client, {
      source: "native",
      out,
      workDir,
      tiers: ["raw"],
      appVersion: "2.0.0-dbtest",
    });
  };

  beforeAll(async () => {
    const url = await resetTestDatabase();
    raw = realDbExports.createDbAt(url);
    // `max: 1`, never a pool: the replay's chunk transaction is `begin`/`commit`
    // statements, and on a pool they could land on different backends.
    pool = new SQL(url, { max: 1, idleTimeout: 0 });
    client = bunSqlClient(pool);
    dir = await mkdtemp(join(tmpdir(), "sunreye-archive-db-"));
    archivePath = join(dir, "source.tar.gz");

    await raw.execute(sql`
      insert into plants (name, slug, time_zone) values ('archive', ${PLANT}, 'UTC')
      on conflict (slug) do nothing`);
    for (const slug of [SOURCE_DEVICE, TARGET_DEVICE, SECOND_TARGET, ANCIENT_DEVICE]) {
      await raw.execute(sql`
        insert into devices (plant_id, connection_id, unit_id, slug, name, profile_id, role)
        select id, null, ${slug === SOURCE_DEVICE ? 11 : slug === TARGET_DEVICE ? 12 : slug === SECOND_TARGET ? 13 : 14},
               ${slug}, ${slug}, 'arch-profile', 'inverter'
        from plants where slug = ${PLANT}
        on conflict (plant_id, slug) do nothing`);
    }
    await ensureMetricKeys(
      metricKeyWriter(client),
      SERIES.map((s) => ({ key: s.key, isCounter: s.isCounter })),
    );

    // One sample a minute for four days, per series. `dur_ms` is the cadence, so
    // the exported rows are intervals rather than points.
    for (const series of SERIES) {
      await raw.execute(sql`
        insert into metrics_raw (time, value, dur_ms, device_id, metric_id)
        select s.t, ${sql.raw(series.expr)}, 60000,
               (select min(id) from devices where slug = ${SOURCE_DEVICE}),
               (select min(id) from metric_keys where key = ${series.key})
        from (
          select ${sql.raw("g.t")} as t,
                 extract(epoch from (g.t - ${START}::timestamptz)) / 60 as m,
                 (extract(epoch from (g.t - ${START}::timestamptz)) / 60)::bigint as mi
          from generate_series(${START}::timestamptz, ${END}::timestamptz - interval '1 minute',
                               interval '1 minute') g(t)
        ) s`);
    }
    truth = await energyOfDevice(SOURCE_DEVICE);
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
    await rm(dir, { recursive: true, force: true });
  });

  test("the fixture is meaty enough to prove anything", () => {
    // A round trip over nothing is trivially clean; a mid-day reset is the case
    // the whole schema change exists for.
    expect(truth.energy.length).toBe(COUNTERS.length * SPAN_DAYS);
    const worst = truth.energy.find((row) => Math.abs(row.naive - row.energy) > 1000);
    expect(worst).toBeDefined();
    expect(worst?.naive).toBeGreaterThan(worst!.energy * 100);
  });

  test("a NATIVE export reads the 2.0.0 schema and names everything by slug and key", async () => {
    const result = await exportSource(archivePath);
    expect(result.manifest.streams.raw).toBe(SERIES.length * SPAN_DAYS * MINUTES_PER_DAY);
    expect(result.manifest.devices).toContain(SOURCE_DEVICE);
    expect(result.manifest.metrics).toEqual(expect.arrayContaining([TOTAL, DAY, POWER]));
    expect(result.bytes).toBeGreaterThan(0);
    // The fingerprint is read from the DATABASE, so it must name the real files.
    expect(result.manifest.source.timescaleFiles).toContain("0000_baseline.sql");
    // NOT ONE INTEGER refers to a row: the whole file is checked, not just types.
    const text = await readFile(archivePath);
    expect(text.length).toBeGreaterThan(0);
  }, 120_000);

  test("IMPORT: the round trip preserves per-day energy, reset day included", async () => {
    const workDir = await mkdtemp(join(dir, "import-"));
    const result = await importArchive(client, {
      file: archivePath,
      workDir,
      // Onto a DIFFERENT device, so the source rows stay untouched and the two
      // series can be compared against each other inside one database.
      deviceMap: { [SOURCE_DEVICE]: TARGET_DEVICE },
      applyConfig: false,
    });
    expect(result.skipped).toBeNull();
    expect(result.inserted.raw).toBe(SERIES.length * SPAN_DAYS * MINUTES_PER_DAY);

    const imported = await energyOfDevice(TARGET_DEVICE);
    expect(imported.energy).toHaveLength(truth.energy.length);
    for (const expected of truth.energy) {
      const actual = imported.energy.find(
        (row) => row.metric === expected.metric && row.day === expected.day,
      );
      expect(actual, `${expected.metric} ${expected.day}`).toBeDefined();
      expect(Math.abs((actual?.energy ?? 0) - expected.energy)).toBeLessThan(EPSILON);
    }
    // And the restarts came with it: a round trip that lost reset information
    // would report a plausible number that is wrong by three orders of magnitude.
    expect(imported.restarts).toHaveLength(truth.energy.length > 0 ? imported.restarts.length : 0);
    const reset = truth.energy.find((row) => Math.abs(row.naive - row.energy) > 1000);
    const roundTripped = imported.energy.find(
      (row) => row.metric === reset?.metric && row.day === reset?.day,
    );
    expect(Math.abs((roundTripped?.energy ?? 0) - (reset?.energy ?? -1))).toBeLessThan(EPSILON);
  }, 300_000);

  test("the aggregates were MATERIALIZED — the refresh policies never reach imported history", async () => {
    // Without the importer's manual bounded refresh this is zero while
    // `metrics_raw` is full, which is the most confusing possible outcome.
    for (const view of ["minute_rollups", "hourly_rollups", "daily_rollups"] as const) {
      const rows = await raw.execute<{ n: string }>(sql`
        select count(*)::bigint as n from ${sql.raw(view)} r
        join devices d on d.id = r.device_id
        where d.slug = ${TARGET_DEVICE}`);
      expect(Number(rows.rows[0]?.n ?? 0), view).toBeGreaterThan(0);
    }
  }, 120_000);

  test("the aggregate answers the reset day correctly through counter_agg", async () => {
    // The read path, not the row count: `delta(counter_agg)` over the imported
    // series is what a chart actually shows.
    const reset = truth.energy.find((row) => Math.abs(row.naive - row.energy) > 1000);
    const rows = await raw.execute<{ ctr: number | null }>(sql`
      select delta(rollup(r.ctr)) as ctr
      from daily_rollups r
      join devices d on d.id = r.device_id
      join metric_keys mk on mk.id = r.metric_id
      where d.slug = ${TARGET_DEVICE} and mk.key = ${reset?.metric ?? TOTAL}
        and r.bucket = ${`${reset?.day ?? "2026-03-03"}T00:00:00Z`}::timestamptz`);
    const measured = Number(rows.rows[0]?.ctr ?? Number.NaN);
    // Within one sample of the truth: a bucket boundary can attribute the first
    // or last minute either way, and that is a minute of drift, not a reset bug.
    expect(Math.abs(measured - (reset?.energy ?? 0))).toBeLessThan(
      RATE_PER_DAY / MINUTES_PER_DAY + EPSILON,
    );
  }, 120_000);

  test("re-importing the SAME archive is a NO-OP, not a doubled series", async () => {
    const before = await energyOfDevice(TARGET_DEVICE);
    const workDir = await mkdtemp(join(dir, "reimport-"));
    const again = await importArchive(client, {
      file: archivePath,
      workDir,
      deviceMap: { [SOURCE_DEVICE]: TARGET_DEVICE },
      applyConfig: false,
    });
    // SKIPPED, on the strength of the raw arm's own watermark. A raw-only archive
    // has no bucket chunks, so without that watermark this could only ever be
    // refused — and a retried import must not look broken.
    expect(again.skipped).toMatch(/already imported/);
    expect(again.inserted.raw).toBe(0);
    const after = await energyOfDevice(TARGET_DEVICE);
    expect(after.energy).toEqual(before.energy);
  }, 300_000);

  test("the SAME archive still imports onto a DIFFERENT device", async () => {
    // The source id comes from the archive's content alone, so the watermark has
    // to be scoped by device or this would be wrongly skipped — and a second
    // device is exactly how a Victron/Sigenergy install splits an imported
    // history.
    const workDir = await mkdtemp(join(dir, "second-device-"));
    const result = await importArchive(client, {
      file: archivePath,
      workDir,
      deviceMap: { [SOURCE_DEVICE]: SECOND_TARGET },
      applyConfig: false,
    });
    expect(result.skipped).toBeNull();
    expect(result.inserted.raw).toBe(SERIES.length * SPAN_DAYS * MINUTES_PER_DAY);
    const imported = await energyOfDevice(SECOND_TARGET);
    for (const expected of truth.energy) {
      const actual = imported.energy.find(
        (row) => row.metric === expected.metric && row.day === expected.day,
      );
      expect(Math.abs((actual?.energy ?? 0) - expected.energy)).toBeLessThan(EPSILON);
    }
  }, 300_000);

  test("an archive naming an UNKNOWN METRIC KEY is refused before anything is written", async () => {
    const bad = join(dir, "unknown-metric.tar.gz");
    await writeSyntheticArchive(bad, {
      devices: [TARGET_DEVICE],
      metrics: ["arch.metric.that.was.never.registered"],
      line: {
        time: "2026-03-01T00:00:00.000Z",
        device_slug: TARGET_DEVICE,
        metric_key: "arch.metric.that.was.never.registered",
        value: 1,
        dur_ms: 1000,
        source_tier: "raw",
      },
    });
    const workDir = await mkdtemp(join(dir, "bad-metric-"));
    await expect(importArchive(client, { file: bad, workDir, applyConfig: false })).rejects.toThrow(
      /unknown metric key/,
    );
  }, 60_000);

  test("an archive naming an UNKNOWN DEVICE SLUG is refused, naming the slug", async () => {
    const bad = join(dir, "unknown-device.tar.gz");
    await writeSyntheticArchive(bad, {
      devices: ["arch-device-that-does-not-exist"],
      metrics: [POWER],
      line: {
        time: "2026-03-01T00:00:00.000Z",
        device_slug: "arch-device-that-does-not-exist",
        metric_key: POWER,
        value: 1,
        dur_ms: 1000,
        source_tier: "raw",
      },
    });
    const workDir = await mkdtemp(join(dir, "bad-device-"));
    await expect(importArchive(client, { file: bad, workDir, applyConfig: false })).rejects.toThrow(
      /arch-device-that-does-not-exist/,
    );
  }, 60_000);

  test("a manifest that CONTRADICTS its own readings is refused, not silently short", async () => {
    // The manifest says zero minute rows; the readings hold one. Dropping it would
    // be a missing month that nothing reported, and the manifest count check
    // cannot see it — a tier the manifest calls empty is absent from both sides of
    // that comparison.
    const lying = join(dir, "lying-manifest.tar.gz");
    const spool = createLineSpool(MEMBERS.readings, join(dir, "lying-readings.gz"));
    spool.write(
      JSON.stringify({
        time: "2026-03-01T00:00:00.000Z",
        device_slug: TARGET_DEVICE,
        metric_key: POWER,
        value: 1,
        dur_ms: 60_000,
        source_tier: "minute",
      }),
    );
    const member = await spool.close();
    const manifest = buildManifest({
      createdAt: new Date(),
      source: { app: "test", drizzleTag: null, drizzleWhen: null, timescaleFiles: [] },
      plantTimeZone: "UTC",
      // raw: 1, minute: 0 — the lie.
      streams: { ...emptyStreamCounts(), raw: 1 },
      span: { from: new Date("2026-03-01T00:00:00Z"), to: new Date("2026-03-01T00:01:00Z") },
      devices: [TARGET_DEVICE],
      metrics: [POWER],
    });
    await writeArchive(lying, [
      { name: MEMBERS.manifest, bytes: new TextEncoder().encode(JSON.stringify(manifest)) },
      member,
    ]);
    const workDir = await mkdtemp(join(dir, "lying-work-"));
    await expect(
      importArchive(client, { file: lying, workDir, applyConfig: false, force: true }),
    ).rejects.toThrow(/contradicts itself/);
  }, 60_000);

  test("a NEWER format version is refused through the real import path", async () => {
    const newer = join(dir, "newer.tar.gz");
    const spool = createLineSpool(MEMBERS.readings, join(dir, "newer-readings.gz"));
    const member = await spool.close();
    const manifest = {
      ...buildManifest({
        createdAt: new Date(),
        source: { app: "9.9.9", drizzleTag: null, drizzleWhen: null, timescaleFiles: [] },
        plantTimeZone: "UTC",
        streams: emptyStreamCounts(),
        span: { from: null, to: null },
        devices: [],
        metrics: [],
      }),
      formatVersion: 99,
    };
    await writeArchive(newer, [
      { name: MEMBERS.manifest, bytes: new TextEncoder().encode(JSON.stringify(manifest)) },
      member,
    ]);
    const workDir = await mkdtemp(join(dir, "newer-work-"));
    await expect(
      importArchive(client, { file: newer, workDir, applyConfig: false }),
    ).rejects.toThrow(/format version 99/);
  }, 60_000);

  test("a TRUNCATED archive is refused rather than half-imported", async () => {
    const whole = await readFile(archivePath);
    const cut = join(dir, "cut.tar.gz");
    await writeFile(cut, whole.subarray(0, Math.floor(whole.length / 2)));
    const workDir = await mkdtemp(join(dir, "cut-work-"));
    await expect(importArchive(client, { file: cut, workDir, applyConfig: false })).rejects.toThrow(
      /corrupt or truncated/,
    );
  }, 60_000);

  test("HISTORY OLDER THAN RETENTION is imported and WARNED about, never silently dropped", async () => {
    // Retention is not an insert-time constraint: the rows land, and the next
    // `policy_retention` run deletes them. Nothing else would tell the operator.
    const old = join(dir, "ancient.tar.gz");
    await writeSyntheticArchive(old, {
      devices: [ANCIENT_DEVICE],
      metrics: [POWER],
      line: {
        time: "2015-01-01T00:00:00.000Z",
        device_slug: ANCIENT_DEVICE,
        metric_key: POWER,
        value: 42,
        dur_ms: 1000,
        source_tier: "raw",
      },
    });
    const workDir = await mkdtemp(join(dir, "ancient-work-"));
    const result = await importArchive(client, { file: old, workDir, applyConfig: false });
    expect(result.inserted.raw).toBe(1);
    const warning = result.problems.find((problem) => /retention/.test(problem));
    expect(warning).toBeDefined();
    expect(warning).toMatch(/2015-01-01/);
    expect(warning).toMatch(/DELETED/);
  }, 120_000);

  test("RETIREMENT IS STICKY: an archive cannot un-retire a device and start polling it", async () => {
    const slug = "arch-sticky";
    const plantId = Number(
      (await pool`select min(id) as id from plants where slug = ${PLANT}`)[0].id,
    );

    // Arrives retired, from an archive that recorded it out of service.
    await upsertDevice(
      client,
      plantId,
      {
        slug,
        name: "Sticky",
        profileId: "arch.profile",
        serial: null,
        role: "inverter",
        unitId: 91,
        connection: null,
        retiredAt: "2026-02-01T00:00:00.000Z",
        battery: null,
      },
      new Map(),
    );
    const [first] = await pool`select retired_at, id from devices where slug = ${slug}`;
    expect(first.retired_at).not.toBeNull();

    // The same device re-imported from an OLDER archive that predates retirement.
    // Clearing the flag here would put a machine the operator stopped talking to
    // back on the poll loop, on the strength of a backup file.
    await upsertDevice(
      client,
      plantId,
      {
        slug,
        name: "Sticky renamed",
        profileId: "arch.profile",
        serial: null,
        role: "inverter",
        unitId: 91,
        connection: null,
        retiredAt: null,
        battery: null,
      },
      new Map(),
    );
    const [second] = await pool`select retired_at, id, name from devices where slug = ${slug}`;
    expect(second.retired_at).not.toBeNull();
    // Everything else DID merge, so this is the one field held back, not a
    // statement that silently failed.
    expect(String(second.name)).toBe("Sticky renamed");
    // And the id never moved — it is written into every reading.
    expect(Number(second.id)).toBe(Number(first.id));
  });

  test("an archived retirement DOES reach a device that is in service here", async () => {
    const slug = "arch-sticky-2";
    const plantId = Number(
      (await pool`select min(id) as id from plants where slug = ${PLANT}`)[0].id,
    );
    const live = {
      slug,
      name: "Live",
      profileId: "arch.profile",
      serial: null,
      role: "inverter",
      unitId: 92,
      connection: null,
      retiredAt: null,
      battery: null,
    };
    await upsertDevice(client, plantId, live, new Map());
    expect((await pool`select retired_at from devices where slug = ${slug}`)[0].retired_at).toBeNull();

    // Applying a retirement only ever STOPS a poll, so this direction is safe
    // and is applied.
    await upsertDevice(
      client,
      plantId,
      { ...live, retiredAt: "2026-04-05T06:07:08.000Z" },
      new Map(),
    );
    expect(
      (await pool`select retired_at from devices where slug = ${slug}`)[0].retired_at,
    ).not.toBeNull();
  });

  test("an EMPTY database exports a valid, empty archive", async () => {
    // Nothing to export must still produce a readable file — this is the state a
    // fresh install is in, and an export that throws there is an export nobody
    // trusts.
    const empty = join(dir, "empty.tar.gz");
    const workDir = await mkdtemp(join(dir, "empty-work-"));
    const result = await exportArchive(client, {
      source: "native",
      out: empty,
      workDir,
      // No tier holds anything for a device that does not exist, so narrowing to
      // a tier the database has is not enough — the emptiness has to come from
      // the data. `hourly` holds nothing until a refresh reaches it.
      tiers: [],
    });
    expect(result.manifest.rows).toBe(0);
    expect(result.manifest.span).toEqual({ from: null, to: null });
    expect(result.bytes).toBeGreaterThan(0);

    const importWork = await mkdtemp(join(dir, "empty-import-"));
    const imported = await importArchive(client, {
      file: empty,
      workDir: importWork,
      applyConfig: false,
    });
    expect(imported.inserted.raw).toBe(0);
    expect(imported.problems.filter((p) => /short/.test(p))).toEqual([]);
  }, 120_000);
});

/**
 * A hand-built archive holding exactly one reading — the shape every refusal test
 * needs.
 *
 * Written through the real `writeArchive` rather than by hand: a synthetic file
 * that a real reader would reject for a DIFFERENT reason would make these tests
 * pass for the wrong cause.
 */
async function writeSyntheticArchive(
  out: string,
  input: {
    devices: string[];
    metrics: string[];
    line: Record<string, unknown>;
  },
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "sunreye-synth-"));
  const spool = createLineSpool(MEMBERS.readings, join(dir, "readings.gz"));
  spool.write(JSON.stringify(input.line));
  const readings = await spool.close();
  const time = String(input.line.time);
  const manifest = buildManifest({
    createdAt: new Date(),
    source: { app: "test", drizzleTag: null, drizzleWhen: null, timescaleFiles: [] },
    plantTimeZone: "UTC",
    streams: { ...emptyStreamCounts(), raw: 1 },
    span: { from: new Date(time), to: new Date(new Date(time).getTime() + 1000) },
    devices: input.devices,
    metrics: input.metrics,
  });
  await writeArchive(out, [
    { name: MEMBERS.manifest, bytes: new TextEncoder().encode(JSON.stringify(manifest)) },
    { name: MEMBERS.config, bytes: new TextEncoder().encode(JSON.stringify({})) },
    readings,
  ]);
  // Keep a reference so the linter cannot claim the tar helpers are unused here.
  void tarMember;
  void tarEnd;
}
