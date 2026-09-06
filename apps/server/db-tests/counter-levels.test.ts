/**
 * `fetchLatestCounterLevels` against a real TimescaleDB — the amortisation
 * reader's fallback for a target the poll cache cannot speak for.
 *
 * `apps/server/src/energy/cost.test.ts` pins the statement's shape (DISTINCT ON
 * over the daily tier, newest bucket per metric, members summed per bucket). It
 * cannot prove the statement RUNS: `distinct on` over a derived table that
 * groups a continuous aggregate is exactly the class of query the unit layer
 * has shipped 500s behind before (AGENTS.md). So the assertion here is a
 * number read through the same function the endpoint calls.
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
const TIERS = ["minute_rollups", "hourly_rollups", "daily_rollups"] as const;

suite("fetchLatestCounterLevels against a real TimescaleDB", () => {
  let fetchLatestCounterLevels: typeof import("../src/energy/cost").fetchLatestCounterLevels;
  let raw: ReturnType<typeof realDbExports.createDbAt>;
  const IMPORT = "levels.import.total";
  const EXPORT = "levels.export.total";
  const members: Array<{ id: number; slug: string; weight: number }> = [];

  /** Maps the two grid counters; production and load stay unmapped on purpose. */
  const profile = {
    id: "levels-a",
    metrics: [
      { role: "grid.energy.imported.total", key: IMPORT },
      { role: "grid.energy.exported.total", key: EXPORT },
    ],
  } as unknown as InverterProfile;

  beforeAll(async () => {
    const url = await resetTestDatabase();
    raw = realDbExports.createDbAt(url);
    mock.module("@SunReye/db", () => ({ ...realDbExports, db: raw }));
    ({ fetchLatestCounterLevels } = await import("../src/energy/cost"));

    await raw.execute(sql`
      insert into plants (name, slug, time_zone) values ('levels', 'counter-levels', 'UTC')`);
    for (const [slug, unit] of [
      ["levels-a", 1],
      ["levels-b", 2],
    ] as const) {
      const row = await raw.execute<{ id: number }>(sql`
        insert into devices (plant_id, connection_id, unit_id, slug, name, profile_id, role)
        select id, null, ${unit}, ${slug}, ${slug}, 'levels-profile', 'inverter'
        from plants where slug = 'counter-levels'
        returning id`);
      members.push({ id: Number((row.rows[0] as { id: number }).id), slug, weight: 1 });
    }
    const metricId = async (key: string) => {
      const row = await raw.execute<{ id: number }>(sql`
        insert into metric_keys (key, is_counter) values (${key}, true)
        on conflict (key) do update set is_counter = excluded.is_counter
        returning id`);
      return Number((row.rows[0] as { id: number }).id);
    };
    const imp = await metricId(IMPORT);
    const exp = await metricId(EXPORT);
    const [a, b] = members;
    if (!a || !b) throw new Error("two members were not seeded");

    // Two days of a rising counter on each member. The level the reader must
    // report is the newest day's HIGH — 1 240 for A, not its 1 200 open, and
    // not the 1 100 the earlier day closed on.
    await raw.execute(sql`
      insert into metrics_raw (time, value, dur_ms, device_id, metric_id) values
        ('2026-03-01 10:00:00Z', 1000, 1000, ${a.id}, ${imp}),
        ('2026-03-01 20:00:00Z', 1100, 1000, ${a.id}, ${imp}),
        ('2026-03-02 08:00:00Z', 1200, 1000, ${a.id}, ${imp}),
        ('2026-03-02 18:00:00Z', 1240, 1000, ${a.id}, ${imp}),
        ('2026-03-01 10:00:00Z', 5000, 1000, ${a.id}, ${exp}),
        ('2026-03-02 18:00:00Z', 5300, 1000, ${a.id}, ${exp}),
        ('2026-03-01 10:00:00Z',  400, 1000, ${b.id}, ${imp}),
        ('2026-03-02 18:00:00Z',  460, 1000, ${b.id}, ${imp}),
        ('2026-03-01 10:00:00Z',  900, 1000, ${b.id}, ${exp}),
        ('2026-03-02 18:00:00Z',  940, 1000, ${b.id}, ${exp})`);

    for (const tier of TIERS) {
      await raw.execute(sql`call refresh_continuous_aggregate(
        ${sql.raw(`'${tier}'`)}, '2026-02-28Z'::timestamptz, '2026-03-04Z'::timestamptz)`);
    }
  });

  afterAll(() => {
    mock.module("@SunReye/db", () => ({ ...realDbExports }));
  });

  test("a device reads each counter's newest daily high, unmapped fields zero", async () => {
    expect(await fetchLatestCounterLevels(profile, "levels-a")).toEqual({
      importKwh: 1240,
      exportKwh: 5300,
      loadKwh: 0,
      productionKwh: 0,
      batteryDischargeKwh: 0,
      batteryChargeKwh: 0,
    });
  });

  test("a plant reads the members' levels summed in the newest bucket", async () => {
    const levels = await fetchLatestCounterLevels(profile, { plant: members });
    expect(levels?.importKwh).toBe(1240 + 460);
    expect(levels?.exportKwh).toBe(5300 + 940);
  });

  test("a device with no rows at all reads null, not a plant that never imported", async () => {
    expect(await fetchLatestCounterLevels(profile, "levels-nobody")).toBeNull();
  });
});
