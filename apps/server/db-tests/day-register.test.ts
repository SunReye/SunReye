/**
 * The daily-resetting `*.today` register, differenced against a real
 * TimescaleDB — both readers, across the plant's midnight.
 *
 * `apps/server/src/energy/cost.test.ts` pins the rule twice over: once in
 * TypeScript (`chainsTo`) and once as SQL text (the `case` in
 * `fetchCounterDeltaMatrix`). Neither proves Postgres accepts the statement, and
 * the day guard adds a `date_trunc … at time zone` over a `lag()` inside a
 * UNION over a continuous aggregate — precisely the shape that has shipped 500s
 * behind a green unit suite before (AGENTS.md). It also proves the two readers
 * AGREE, which no text assertion can: the same recording is read through both.
 *
 * The recording is one register closing a day at 18 kWh and starting the next at
 * zero. Chaining across that drop would clamp the first hour of every day to
 * nothing; reading the bucket's own `max − min` without the guard on the
 * lifetime twin books the odometer.
 */
import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import type { InverterProfile } from "@SunReye/inverter-core";
import { sql } from "drizzle-orm";
import { databaseReachable, resetTestDatabase } from "./harness";

const reachable = await databaseReachable();

const realDb = await import("@SunReye/db");
const realDbExports = { ...realDb };

if (!reachable) {
  const message =
    "db-tests: no Postgres reachable via DB_TEST_URL/DATABASE_URL. Start one with `bun run db:start`.";
  if (process.env.CI) throw new Error(`${message} In CI this layer must never be skipped.`);
  console.warn(`${message} Skipping.`);
}

const suite = reachable ? describe : describe.skip;

suite("the *.today register across midnight, against a real TimescaleDB", () => {
  let cost: typeof import("../src/energy/cost");
  let raw: ReturnType<typeof realDbExports.createDbAt>;
  const TODAY_KEY = "day.import.today";
  const TOTAL_KEY = "day.import.total";

  /** Maps both twins, so the hourly path must choose the day register itself. */
  const profile = {
    id: "day-reg",
    metrics: [
      { role: "grid.energy.imported.today", key: TODAY_KEY },
      { role: "grid.energy.imported.total", key: TOTAL_KEY },
    ],
  } as unknown as InverterProfile;

  // The window opens on the last hour of 1 March and runs into 2 March, so the
  // reset sits inside it with a real predecessor on the far side.
  const from = new Date("2026-03-01T23:00:00Z");
  const to = new Date("2026-03-02T02:00:00Z");

  beforeAll(async () => {
    const url = await resetTestDatabase();
    raw = realDbExports.createDbAt(url);
    mock.module("@SunReye/db", () => ({ ...realDbExports, db: raw }));
    cost = await import("../src/energy/cost");

    await raw.execute(sql`
      insert into plants (name, slug, time_zone) values ('day', 'day-register', 'UTC')`);
    const device = await raw.execute<{ id: number }>(sql`
      insert into devices (plant_id, connection_id, unit_id, slug, name, profile_id, role)
      select id, null, 1, 'day-reg', 'day-reg', 'day-profile', 'inverter'
      from plants where slug = 'day-register'
      returning id`);
    const deviceId = Number((device.rows[0] as { id: number }).id);
    const metricId = async (key: string) => {
      const row = await raw.execute<{ id: number }>(sql`
        insert into metric_keys (key, is_counter) values (${key}, true)
        on conflict (key) do update set is_counter = excluded.is_counter
        returning id`);
      return Number((row.rows[0] as { id: number }).id);
    };
    const today = await metricId(TODAY_KEY);
    const total = await metricId(TOTAL_KEY);

    // The day register: 17 → 18 through the last two hours of 1 March, back to
    // zero at midnight, 0.1 → 0.5 through the first two hours of 2 March. The
    // lifetime twin rises by exactly the same kWh from a four-digit odometer.
    await raw.execute(sql`
      insert into metrics_raw (time, value, dur_ms, device_id, metric_id) values
        ('2026-03-01 22:10:00Z', 16.0, 1000, ${deviceId}, ${today}),
        ('2026-03-01 22:50:00Z', 17.0, 1000, ${deviceId}, ${today}),
        ('2026-03-01 23:10:00Z', 17.4, 1000, ${deviceId}, ${today}),
        ('2026-03-01 23:50:00Z', 18.0, 1000, ${deviceId}, ${today}),
        ('2026-03-02 00:10:00Z',  0.1, 1000, ${deviceId}, ${today}),
        ('2026-03-02 00:50:00Z',  0.4, 1000, ${deviceId}, ${today}),
        ('2026-03-02 01:10:00Z',  0.5, 1000, ${deviceId}, ${today}),
        ('2026-03-01 22:10:00Z', 3754.0, 1000, ${deviceId}, ${total}),
        ('2026-03-01 22:50:00Z', 3755.0, 1000, ${deviceId}, ${total}),
        ('2026-03-01 23:10:00Z', 3755.4, 1000, ${deviceId}, ${total}),
        ('2026-03-01 23:50:00Z', 3756.0, 1000, ${deviceId}, ${total}),
        ('2026-03-02 00:10:00Z', 3756.1, 1000, ${deviceId}, ${total}),
        ('2026-03-02 00:50:00Z', 3756.4, 1000, ${deviceId}, ${total}),
        ('2026-03-02 01:10:00Z', 3756.5, 1000, ${deviceId}, ${total})`);

    for (const tier of ["minute_rollups", "hourly_rollups", "daily_rollups"] as const) {
      await raw.execute(sql`call refresh_continuous_aggregate(
        ${sql.raw(`'${tier}'`)}, '2026-02-28Z'::timestamptz, '2026-03-04Z'::timestamptz)`);
    }
  });

  afterAll(() => {
    mock.module("@SunReye/db", () => ({ ...realDbExports }));
  });

  test("fetchBucketEnergy prices the first hour of the new day, not zero", async () => {
    const buckets = await cost.fetchBucketEnergy(
      profile,
      "day-reg",
      from,
      to,
      "hourly_rollups",
      "UTC",
    );
    expect(buckets.map((b) => b.time.toISOString())).toEqual([
      "2026-03-01T23:00:00.000Z",
      "2026-03-02T00:00:00.000Z",
      "2026-03-02T01:00:00.000Z",
    ]);
    // 23:00 chains to its predecessor (18.0 − 17.0). 00:00 cannot — the register
    // has reset — so it claims the 0.3 it watched happen, never 0 and never 18.
    expect(buckets[0]?.import).toBeCloseTo(1, 6);
    expect(buckets[1]?.import).toBeCloseTo(0.3, 6);
    expect(buckets[2]?.import).toBeCloseTo(0.1, 6);
  });

  test("fetchCounterDeltaMatrix agrees, day for day", async () => {
    const { rows, fieldByKey } = await cost.fetchCounterDeltaMatrix(profile, {
      from,
      to,
      bucket: "day",
      inverterId: "day-reg",
      view: "hourly_rollups",
      tz: "UTC",
    });
    // Only the day register is read at hourly granularity; the odometer's key is
    // not even in the statement.
    expect([...fieldByKey.keys()]).toEqual([TODAY_KEY]);
    const byPeriod = new Map<string, number>();
    for (const r of rows) {
      byPeriod.set(r.period, (byPeriod.get(r.period) ?? 0) + Number(r.kwh));
    }
    expect(byPeriod.get("2026-03-01")).toBeCloseTo(1, 6);
    // 0.3 + 0.1. Chaining through the reset would clamp the first hour away and
    // leave 0.1 here.
    expect(byPeriod.get("2026-03-02")).toBeCloseTo(0.4, 6);
  });

  test("a day or longer bucket still reads the lifetime odometer", async () => {
    // A counter that resets at midnight cannot describe a bucket a day wide, so
    // the daily tier keeps the `*.total` key it always had.
    const { fieldByKey } = await cost.fetchCounterDeltaMatrix(profile, {
      from: new Date("2026-03-01T00:00:00Z"),
      to: new Date("2026-03-03T00:00:00Z"),
      bucket: "day",
      inverterId: "day-reg",
      view: "daily_rollups",
      tz: "UTC",
    });
    expect([...fieldByKey.keys()]).toEqual([TOTAL_KEY]);
  });
});
