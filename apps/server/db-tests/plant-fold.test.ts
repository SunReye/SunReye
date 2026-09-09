/**
 * The plant fold against a real TimescaleDB — `queryRollup` with a member set.
 *
 * Rows, never SQL text: the fold is a `GROUP BY` over a windowed sub-select
 * joined to a `VALUES` list of weights, and whether Postgres accepts that shape
 * — and interpolates per device before adding — is only knowable by running it
 * (issue #202; see AGENTS.md on the database layer).
 */
import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
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
const TIERS = ["minute_rollups", "hourly_rollups", "daily_rollups"] as const;

suite("the plant fold against a real TimescaleDB", () => {
  let queryRollup: typeof import("../src/shared/history").queryRollup;
  let raw: ReturnType<typeof realDbExports.createDbAt>;
  const POWER = "plant.fold.power";
  const SOC = "plant.fold.soc";
  /** Two live members and one that has no rows in the window at all. */
  const members: Array<{ id: number; slug: string; weight: number }> = [];

  beforeAll(async () => {
    const url = await resetTestDatabase();
    raw = realDbExports.createDbAt(url);
    mock.module("@SunReye/db", () => ({ ...realDbExports, db: raw }));
    ({ queryRollup } = await import("../src/shared/history"));

    await raw.execute(sql`
      insert into plants (name, slug, time_zone) values ('fold', 'plant-fold', 'UTC')`);
    for (const [slug, unit, weight] of [
      ["fold-a", 1, 10],
      ["fold-b", 2, 5],
      ["fold-silent", 3, 1],
    ] as const) {
      const row = await raw.execute<{ id: number }>(sql`
        insert into devices (plant_id, connection_id, unit_id, slug, name, profile_id, role)
        select id, null, ${unit}, ${slug}, ${slug}, 'fold-profile', 'inverter'
        from plants where slug = 'plant-fold'
        returning id`);
      members.push({ id: Number((row.rows[0] as { id: number }).id), slug, weight });
    }
    const metricId = async (key: string) => {
      const row = await raw.execute<{ id: number }>(sql`
        insert into metric_keys (key, is_counter) values (${key}, false)
        on conflict (key) do update set is_counter = excluded.is_counter
        returning id`);
      return Number((row.rows[0] as { id: number }).id);
    };
    const power = await metricId(POWER);
    const soc = await metricId(SOC);
    const [a, b] = members as [(typeof members)[0], (typeof members)[1]];
    // Two hours of held values on both live members. Device b is polled a
    // minute later than a inside each hour, which is the alignment the fold
    // must survive; the silent member has no rows.
    await raw.execute(sql`
      insert into metrics_raw (time, value, dur_ms, device_id, metric_id) values
        ('2026-04-01 10:00:00Z', 100, 3600000, ${a.id}, ${power}),
        ('2026-04-01 11:00:00Z', 300, 3600000, ${a.id}, ${power}),
        ('2026-04-01 12:00:00Z', 300,    1000, ${a.id}, ${power}),
        ('2026-04-01 10:01:00Z',  50, 3600000, ${b.id}, ${power}),
        ('2026-04-01 11:01:00Z',  70, 3600000, ${b.id}, ${power}),
        ('2026-04-01 12:01:00Z',  70,    1000, ${b.id}, ${power}),
        ('2026-04-01 10:00:00Z', 100, 3600000, ${a.id}, ${soc}),
        ('2026-04-01 11:00:00Z', 100, 3600000, ${a.id}, ${soc}),
        ('2026-04-01 12:00:00Z', 100,    1000, ${a.id}, ${soc}),
        ('2026-04-01 10:01:00Z',  40, 3600000, ${b.id}, ${soc}),
        ('2026-04-01 11:01:00Z',  40, 3600000, ${b.id}, ${soc}),
        ('2026-04-01 12:01:00Z',  40,    1000, ${b.id}, ${soc})`);
    for (const tier of TIERS) {
      await raw.execute(sql`call refresh_continuous_aggregate(
        ${sql.raw(`'${tier}'`)}, '2026-03-31Z'::timestamptz, '2026-04-02Z'::timestamptz)`);
    }
  });

  afterAll(() => {
    mock.module("@SunReye/db", () => ({ ...realDbExports }));
  });

  const hour = (metric: string, plant: Parameters<typeof queryRollup>[0]["plant"]) =>
    queryRollup({
      metric,
      inverterId: "plant",
      bucket: "hour",
      limit: 100,
      from: new Date("2026-04-01T11:00:00Z"),
      to: new Date("2026-04-01T12:00:00Z"),
      ...(plant ? { plant } : {}),
    });

  test("the statement is accepted, and a sum is the members' hours added", async () => {
    const rows = await hour(POWER, { members, aggregate: "sum" });
    expect(rows).toHaveLength(1);
    // a held 300 for the hour; b held 50 for its first minute then 70 — so a
    // touch under 370, never the 300 a last-writer read would give.
    expect(rows[0]!.avg).toBeGreaterThan(360);
    expect(rows[0]!.avg).toBeLessThanOrEqual(370);
    expect(rows[0]!.max).toBe(370);
  });

  test("a weighted mean: 10 kWh at 100 % and 5 kWh at 40 % read 80 %", async () => {
    const rows = await hour(SOC, { members, aggregate: "weighted-mean" });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.avg).toBeCloseTo(80, 5);
    // The extrema of a mean are the members' own, not their sum.
    expect(rows[0]!.max).toBe(100);
    expect(rows[0]!.min).toBe(40);
  });

  test("a member with no rows in the window contributes nothing — the others' sum stands", async () => {
    const withSilent = await hour(POWER, { members, aggregate: "sum" });
    const withoutSilent = await hour(POWER, { members: members.slice(0, 2), aggregate: "sum" });
    expect(withSilent).toEqual(withoutSilent);
  });

  test("a plant of ONE member is byte-equal to that member's own series", async () => {
    const a = members[0]!;
    const plant = await hour(POWER, { members: [a], aggregate: "sum" });
    const device = await queryRollup({
      metric: POWER,
      inverterId: a.slug,
      bucket: "hour",
      limit: 100,
      from: new Date("2026-04-01T11:00:00Z"),
      to: new Date("2026-04-01T12:00:00Z"),
    });
    expect(plant).toEqual(device);
  });

  test("a plant of no members is an empty series, never an error", async () => {
    expect(await hour(POWER, { members: [], aggregate: "sum" })).toEqual([]);
    expect(await hour(SOC, { members: [], aggregate: "weighted-mean" })).toEqual([]);
  });

  test("the minute and daily tiers accept the same fold", async () => {
    for (const bucket of ["minute", "day"] as const) {
      const rows = await queryRollup({
        metric: POWER,
        inverterId: "plant",
        bucket,
        limit: 2000,
        from: new Date("2026-04-01T00:00:00Z"),
        to: new Date("2026-04-02T00:00:00Z"),
        plant: { members, aggregate: "sum" },
      });
      expect(rows.length).toBeGreaterThan(0);
    }
  });
});
