/**
 * THE OPTIMIZER'S DECISIONS ARE HISTORY — end to end, against a real TimescaleDB.
 *
 * The claim step 9 actually makes. Before it, every number the optimizer
 * produced lived in a 2 880-slot in-memory ring: 24 hours, gone on restart,
 * readable through exactly one hand-written endpoint, chartable by exactly one
 * hand-written series builder, and invisible to rollups, CSV export, custom
 * charts, the archive and the statistics layer — which reads `metrics_raw`, and
 * `metrics_raw` had never heard of the optimizer.
 *
 * It has to be a database spec, not a unit spec. `metrics_raw.device_id` is a
 * NOT NULL foreign key `ON DELETE RESTRICT` into a table whose ids are
 * `GENERATED ALWAYS AS IDENTITY`; the read path resolves a device SLUG back to
 * that int2; the rollup goes through a Timescale hyperfunction over a continuous
 * aggregate. A SQL-text assertion can speak to none of it — two 500s shipped
 * behind a fully green unit suite that way.
 */
import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { sql } from "drizzle-orm";
import type { PeakShavingStatus } from "@SunReye/contracts/automation";
import { databaseReachable, resetTestDatabase } from "./harness";

const reachable = await databaseReachable();

// The real module namespace is live, so the real exports have to be snapshotted
// BY VALUE before anything is installed over them — see AGENTS.md on
// `mock.module` being process-global and permanent.
const realDb = await import("@SunReye/db");
const realDbExports = { ...realDb };

if (!reachable) {
  const message =
    "db-tests: no Postgres reachable via DB_TEST_URL/DATABASE_URL. Start one with `bun run db:start`.";
  if (process.env.CI) throw new Error(`${message} In CI this layer must never be skipped.`);
  console.warn(`${message} Skipping.`);
}

const suite = reachable ? describe : describe.skip;

/** This suite's own plant, so every assertion is scoped to rows it wrote. */
const PLANT = "optimizer-plant";
/** The inverter beside it — the device the plant's TOTALS are summed from. */
const INVERTER = "opt-inverter";

suite("the optimizer's decisions reach metrics_raw and come back out", () => {
  let raw: ReturnType<typeof realDbExports.createDbAt>;
  let plantId = 0;

  beforeAll(async () => {
    const url = await resetTestDatabase();
    raw = realDbExports.createDbAt(url);
    mock.module("@SunReye/db", () => ({ ...realDbExports, db: raw }));

    await raw.execute(
      sql`insert into plants (name, slug, time_zone) values ('Opt', ${PLANT}, 'UTC')`,
    );
    const { rows } = await raw.execute(sql`select id from plants where slug = ${PLANT}`);
    plantId = Number((rows[0] as { id: number }).id);
  });

  afterAll(() => {
    mock.module("@SunReye/db", () => ({ ...realDbExports }));
  });

  /**
   * The production write seam, wired exactly as `../src/inverter/runtime.ts`
   * wires it — one writer, one identity resolver, one buffer pair.
   *
   * Built per call rather than once, because that is what a RESTART is: the
   * process comes back with empty closures, a fresh policy and no memory of the
   * value every metric was holding. The ring lost 24 hours to that; this loses
   * nothing, and the test that proves it simply calls this twice.
   */
  async function bootWriteSeam() {
    const { createDeviceRegistry } = await import("../src/devices/registry");
    const { resolveCoded } = await import("../src/devices/coded");
    const { createDeviceWriter } = await import("../src/inverter/device-writer");
    const { createHistoryBuffer } = await import("../src/inverter/history-buffer");
    const { createIdentifiedCommit, createRowIdentifier } =
      await import("../src/inverter/storage-identity");
    const { createIdentityResolver } = await import("../src/shared/identity");
    const { metricsConfigLog, metricsRaw } = await import("@SunReye/db/schema/metrics");
    const { createOptimizerRegistrar } = await import("../src/automation/optimizer-registrar");
    const { OPTIMIZER_DEVICE_ID, optimizerDeviceSpec } =
      await import("../src/automation/optimizer-device");
    const repo = await import("@SunReye/db/plant-repo");

    const identity = createIdentityResolver({ db: raw });
    const buffer = (table: typeof metricsRaw | typeof metricsConfigLog) =>
      createHistoryBuffer({
        commit: createIdentifiedCommit({
          identify: createRowIdentifier({ resolver: identity, logger: { warn: () => {} } })
            .identify,
          insert: (rows) => raw.insert(table).values(rows),
        }),
        logger: { error: () => {} },
      });
    const series = buffer(metricsRaw);
    const config = buffer(metricsConfigLog);
    const writer = createDeviceWriter({
      series,
      config,
      registerMetrics: (specs) => void identity.registerMetrics(specs),
    });

    // The registry over the REAL table, with the CODED tier wired: the
    // optimizer's `profile_id` names a declaration compiled into the server, and
    // the profile store is never asked about it. `resolveProfile` throwing for it
    // is what proves that.
    const registry = createDeviceRegistry({
      readDevices: () => repo.readDevices(raw, plantId, { includeRetired: false }),
      resolveProfile: async (id) => {
        if (id.startsWith("sunreye.")) {
          throw new Error(`the profile store must never be asked about ${id}`);
        }
        return null;
      },
      resolveCoded,
      logger: { warn: () => {} },
    });

    const registrar = createOptimizerRegistrar({
      async ensureDevice() {
        const row = await repo.ensureDevice(raw, optimizerDeviceSpec(plantId));
        return repo.isRetired(row) ? "retired" : "ready";
      },
      reloadRegistry: async () => void (await registry.reload()),
      device: () => registry.get(OPTIMIZER_DEVICE_ID),
      commit: writer.commit,
      logger: { warn: () => {} },
    });

    return {
      registrar,
      /** Shutdown: close every open interval and drain both buffers. */
      async shutdown(at: Date) {
        writer.close(at);
        await series.flush();
        await config.flush();
      },
      async flush() {
        await series.flush();
        await config.flush();
      },
    };
  }

  /** A steering tick's status; only what a case asserts on is spelled out. */
  async function decided(over: Partial<PeakShavingStatus> = {}): Promise<PeakShavingStatus> {
    const { initialStatus } = await import("../src/automation/peak-shaving-engine");
    return {
      ...initialStatus(),
      enabled: true,
      mode: "grid-friendly",
      state: "active",
      targetA: 40,
      lastWrittenA: 40,
      thresholdW: 6000,
      liveExcessW: 2000,
      headroomKwh: 5,
      remainingAboveLimitKwh: 2,
      priceRegime: "none",
      ...over,
    };
  }

  /**
   * A window far from the wall clock, so nothing here depends on when the suite
   * runs. It straddles LOCAL MIDNIGHT of the plant's UTC day on purpose.
   */
  const MIDNIGHT = new Date("2026-05-02T00:00:00.000Z");
  const at = (secondsFromMidnight: number) =>
    new Date(MIDNIGHT.getTime() + secondsFromMidnight * 1000);

  test("nothing decided yet is an EMPTY series, not a row of zeros", async () => {
    // The boundary the whole "absent is absent" rule exists for: a plant whose
    // optimizer has never decided must have no optimizer rows at all. A `0 A`
    // ceiling written on boot would be a decision that was never made, and every
    // rollup and every chart would believe it.
    const seam = await bootWriteSeam();
    await seam.flush();
    const { rows } = await raw.execute(sql`
      select count(*)::int as n from metrics_raw r
        join devices d on d.id = r.device_id
       where d.slug = 'optimizer'`);
    expect((rows[0] as { n: number }).n).toBe(0);
  });

  test("a decision is a row in the hypertable, keyed to the optimizer's device", async () => {
    const seam = await bootWriteSeam();
    // Three ticks either side of local midnight. The value CHANGES each time, so
    // each interval closes and is written; a steady ceiling would (correctly)
    // still be one open interval.
    await seam.registrar.record(await decided({ targetA: 40 }), 800, at(-60));
    await seam.registrar.record(await decided({ targetA: 25 }), 900, at(-30));
    await seam.registrar.record(await decided({ targetA: 10 }), 0, at(30));
    await seam.shutdown(at(60));

    const { rows } = await raw.execute(sql`
      select d.slug, k.key, r.value, r.dur_ms from metrics_raw r
        join metric_keys k on k.id = r.metric_id
        join devices d on d.id = r.device_id
       where k.key = 'optimizer.target.current'
       order by r.time`);
    // Every value the optimizer decided, each as an INTERVAL — the shape the
    // time-weighted aggregates need, produced by the same change encoder the
    // poll loop's readings go through.
    //
    // The middle interval is 30 s rather than the 60 s between its two ticks
    // because it crosses a minute boundary and the tick cadence (30 s) is longer
    // than the encoder's gap tolerance (15 s): past that, a silence stops being
    // a held value and becomes a gap, so the record says "unknown" rather than
    // inventing a hold. That rule is `../src/inverter/change-encoder.ts`'s and it
    // applies to every device; it is conservative here, never wrong.
    expect(rows).toEqual([
      { slug: "optimizer", key: "optimizer.target.current", value: 40, dur_ms: 30_000 },
      { slug: "optimizer", key: "optimizer.target.current", value: 25, dur_ms: 30_000 },
      { slug: "optimizer", key: "optimizer.target.current", value: 10, dur_ms: 30_000 },
    ]);

    // A DAY BOUNDARY is nothing special to the hypertable, and that is the
    // point: the ring's 24 h capacity made "yesterday" a cliff.
    const { rows: days } = await raw.execute(sql`
      select date_trunc('day', r.time) as day, count(*)::int as n from metrics_raw r
        join metric_keys k on k.id = r.metric_id
        join devices d on d.id = r.device_id
       where d.slug = 'optimizer' and k.key = 'optimizer.target.current'
       group by 1 order by 1`);
    expect(days).toHaveLength(2);

    // The metric's class and unit travelled WITH the key: a continuous aggregate
    // cannot ask a device what a metric means.
    const { rows: keys } = await raw.execute(sql`
      select key, unit, is_counter from metric_keys
       where key in ('optimizer.target.current', 'optimizer.state') order by key`);
    expect(keys).toEqual([
      { key: "optimizer.state", unit: null, is_counter: false },
      { key: "optimizer.target.current", unit: "A", is_counter: false },
    ]);
  });

  test("a null decision is ABSENT, and a measured zero is a row", async () => {
    // `socEnvelopePct: null` is "not pre-shaping" and `liveExcessW: 0` is a fact
    // about now. A policy that wrote 0 for both would make them the same row.
    const seam = await bootWriteSeam();
    await seam.registrar.record(
      await decided({ socEnvelopePct: null, liveExcessW: 0, targetA: 7 }),
      0,
      at(600),
    );
    await seam.shutdown(at(660));

    const { rows } = await raw.execute(sql`
      select k.key, r.value from metrics_raw r
        join metric_keys k on k.id = r.metric_id
        join devices d on d.id = r.device_id
       where d.slug = 'optimizer' and r.time >= ${at(600)}
       order by k.key`);
    const stored = new Map(
      rows.map((r) => [(r as { key: string }).key, (r as { value: number }).value]),
    );
    expect(stored.has("optimizer.soc.envelope")).toBe(false);
    expect(stored.get("optimizer.excess.power")).toBe(0);
  });

  test("the decisions come back out of the /api/history read path, by SLUG", async () => {
    // THE PRODUCTION FUNCTION, not a hand-written copy of its SELECT.
    // `queryRawHistory` is what `../src/inverter/entities.ts` invokes for
    // `/api/history`, and it resolves the device SLUG through
    // `deviceIdOf(devices.slug)` — a correlated subquery against a table whose
    // ids are `GENERATED ALWAYS AS IDENTITY`. A device with `connection_id NULL`
    // and `unit_id 0` is a new SHAPE for that resolution, and a SQL-text
    // assertion (or a second, hand-written join beside it) can execute none of
    // it: it would stay green against a read path that had stopped answering.
    const { queryRawHistory } = await import("../src/shared/history");

    // Its OWN decisions, so the assertion is on values this test wrote rather
    // than on whatever earlier cases happened to leave behind — a `length > 0`
    // over shared rows passes in file order and is vacuously green alone.
    const seam = await bootWriteSeam();
    await seam.registrar.record(await decided({ thresholdW: 1111 }), 0, at(1200));
    await seam.registrar.record(await decided({ thresholdW: 2222 }), 0, at(1230));
    await seam.registrar.record(await decided({ thresholdW: 3333 }), 0, at(1260));
    await seam.shutdown(at(1290));

    const rows = await queryRawHistory({
      metric: "optimizer.threshold.power",
      inverterId: "optimizer",
      since: at(1200),
      limit: 5000,
    });
    // Newest first — the order the endpoint's contract promises — and every
    // value is one this test decided.
    expect(rows.map((r) => r.value)).toEqual([3333, 2222, 1111]);

    // And the slug is doing the filtering, not the metric key alone: the same
    // read under a device that is not the optimizer answers with nothing, so a
    // resolution that silently matched everything would fail here.
    const elsewhere = await queryRawHistory({
      metric: "optimizer.threshold.power",
      inverterId: "not-the-optimizer",
      since: at(1200),
      limit: 5000,
    });
    expect(elsewhere).toEqual([]);
  });

  test("a restart does not lose a single decision — the ring lost all of them", async () => {
    // THE claim of #172. The ring was module-closure state: 24 hours of
    // decisions and every one of them gone on the next deploy, the next crash,
    // the next add-on update.
    const before = await bootWriteSeam();
    await before.registrar.record(await decided({ targetA: 55 }), 0, at(3600));
    // The process goes away — with the interval still OPEN, which is the case
    // that loses data if shutdown does not close it.
    await before.shutdown(at(3630));

    const after = await bootWriteSeam();
    await after.registrar.record(await decided({ targetA: 11 }), 0, at(3660));
    await after.shutdown(at(3690));

    const { rows } = await raw.execute(sql`
      select r.value from metrics_raw r
        join metric_keys k on k.id = r.metric_id
        join devices d on d.id = r.device_id
       where d.slug = 'optimizer' and k.key = 'optimizer.target.current'
         and r.time >= ${at(3600)}
       order by r.time`);
    expect(rows.map((r) => (r as { value: number }).value)).toEqual([55, 11]);
  });

  test("the rollup reads optimizer series with no special case at all", async () => {
    // `queryRollup` is the function the dashboard, the custom charts and the CSV
    // export all call. It is handed a metric and a device slug and knows nothing
    // about what kind of device that is — which is the whole reason the optimizer
    // is a device.
    const { queryRollup } = await import("../src/shared/history");
    for (const tier of ["minute_rollups", "hourly_rollups", "daily_rollups"] as const) {
      await raw.execute(sql`call refresh_continuous_aggregate(
        ${sql.raw(`'${tier}'`)}, '2026-05-01Z'::timestamptz, '2026-05-03Z'::timestamptz)`);
    }
    const rows = await queryRollup({
      metric: "optimizer.target.current",
      inverterId: "optimizer",
      bucket: "minute",
      limit: 5000,
      from: new Date("2026-05-01T23:00:00Z"),
      to: new Date("2026-05-02T02:00:00Z"),
    });
    expect(rows.length).toBeGreaterThan(0);
    // Real numbers out of a hyperfunction, not nulls: `average(tw)` over a
    // single-sample bucket is NULL, and a change-encoded series leaves most
    // buckets holding exactly one sample.
    expect(rows.every((r) => typeof r.avg === "number" && Number.isFinite(r.avg))).toBe(true);
  });

  test("the optimizer contributes NOTHING to the plant's production or consumption", async () => {
    // The audit #168 landed: a device row that is not a machine must never be
    // summed into a plant total. The guard is structural in two independent
    // ways, and this asserts both against the real table.
    const repo = await import("@SunReye/db/plant-repo");
    await raw.execute(sql`
      insert into devices (plant_id, connection_id, unit_id, slug, name, profile_id, role)
      values (${plantId}, null, 1, ${INVERTER}, 'Inverter', 'test-profile', 'inverter')
      on conflict (plant_id, slug) do nothing`);

    // 1. ROLE. The optimizer is virtual, so every consumer that walks the
    //    plant's machines skips it.
    const devices = await repo.readDevices(raw, plantId, { includeRetired: false });
    expect(devices.map((d) => d.slug).sort()).toEqual([INVERTER, "optimizer"]);
    expect(repo.physicalDevices(devices).map((d) => d.slug)).toEqual([INVERTER]);

    // 2. VOCABULARY. Not one key it writes is a production, consumption, grid or
    //    battery key. Even a consumer that ignored the role would sum nothing.
    const { rows: keys } = await raw.execute(sql`
      select distinct k.key from metrics_raw r
        join metric_keys k on k.id = r.metric_id
        join devices d on d.id = r.device_id
       where d.slug = 'optimizer'`);
    expect(keys.length).toBeGreaterThan(0);
    for (const row of keys) {
      expect((row as { key: string }).key.startsWith("optimizer.")).toBe(true);
    }

    // 3. And the statistics layer, which is keyed BY DEVICE, reads the inverter's
    //    rows — of which there are none, so its totals are zero however many
    //    optimizer rows sit beside them in the same hypertable.
    const { rows: totals } = await raw.execute(sql`
      select coalesce(sum(r.value), 0)::float8 as summed from metrics_raw r
        join devices d on d.id = r.device_id
       where d.slug = ${INVERTER}`);
    expect((totals[0] as { summed: number }).summed).toBe(0);
  });

  test("the operator's own settings are a change-log, not 2 880 rows a day", async () => {
    // `enabled` and `mode` are configuration: one row when they actually change.
    // Twenty ticks of an unchanged mode must be ONE row, or the storage-cost
    // argument for making this a device is wrong.
    const seam = await bootWriteSeam();
    for (let i = 0; i < 20; i++) {
      await seam.registrar.record(await decided({ targetA: i }), 0, at(7200 + i * 30));
    }
    await seam.shutdown(at(8000));

    const { rows } = await raw.execute(sql`
      select k.key, count(*)::int as n from metrics_config_log c
        join metric_keys k on k.id = c.metric_id
        join devices d on d.id = c.device_id
       where d.slug = 'optimizer' and c.time >= ${at(7200)}
       group by 1 order by 1`);
    // ONE row each for twenty unchanged ticks — the change-log doing its job.
    // As a series they would have been sixty rows, and 2 880 a day.
    expect(rows).toEqual([
      { key: "optimizer.enabled", n: 1 },
      { key: "optimizer.mode", n: 1 },
      { key: "optimizer.restore.pending", n: 1 },
    ]);
  });
});
