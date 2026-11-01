/**
 * Oracle groups 3 and 4 — rollups and statistics — from the 2.x read path against TimescaleDB.
 *
 * Rollup rows come from `queryRollup`, the function the dashboard calls. Statistics come from the
 * same counter-delta matrix and `derivePeriodEnergy` that `energySeries` uses, composed here because
 * `energySeries` also reads the plant zone from settings and the live poll cache.
 */
import type { InverterProfile } from "@SunReye/inverter-core";
import { periodWindow } from "@SunReye/inverter-core/zoned-calendar";
import { sql } from "drizzle-orm";

import { type OracleCase, COUNTER_KEYS, KEYS, CASES } from "./streams";
import type { Db } from "./files";
import { ndjson } from "./files";

/** The plant time zone of every case. */
export const PLANT_TZ = "Europe/Berlin";

const TIERS = ["minute_rollups", "hourly_rollups", "daily_rollups"] as const;
const BUCKETS = ["minute", "hour", "day"] as const;
const DAY_MS = 86_400_000;

const slugOf = (c: OracleCase): string => `oracle-${c.id}`;

/** A profile that maps only the energy roles a case has data for. */
export function profileOf(c: OracleCase): InverterProfile {
  const roles: Array<[string, string]> = [
    ["grid.energy.imported.total", KEYS.import],
    ["grid.energy.exported.total", KEYS.export],
    ["production.total", KEYS.production],
    ["production.today", KEYS.productionToday],
  ];
  const present = roles.filter(([, key]) => c.readings[key] !== undefined);
  return {
    id: slugOf(c),
    metrics: present.map(([role, key]) => ({ role, key })),
  } as unknown as InverterProfile;
}

async function idOf(db: Db, query: ReturnType<typeof sql>): Promise<number> {
  const row = await db.execute<{ id: number }>(query);
  return Number((row.rows[0] as { id: number }).id);
}

/** Insert one case's readings and materialise every tier over its span. */
export async function seedCase(db: Db, c: OracleCase): Promise<void> {
  await db.execute(sql`
    insert into plants (name, slug, time_zone) values ('oracle', 'oracle', ${PLANT_TZ})
    on conflict (slug) do nothing`);
  const deviceId = await idOf(
    db,
    sql`insert into devices (plant_id, connection_id, unit_id, slug, name, profile_id, role)
        select id, null, 1, ${slugOf(c)}, ${slugOf(c)}, 'oracle-profile', 'inverter'
        from plants where slug = 'oracle'
        returning id`,
  );
  for (const [key, readings] of Object.entries(c.readings)) {
    const metricId = await idOf(
      db,
      sql`insert into metric_keys (key, is_counter) values (${key}, ${COUNTER_KEYS.has(key)})
          on conflict (key) do update set is_counter = excluded.is_counter
          returning id`,
    );
    for (const [time, value] of readings) {
      await db.execute(sql`
        insert into metrics_raw (time, value, dur_ms, device_id, metric_id)
        values (${time}::timestamptz, ${value}, 1000, ${deviceId}, ${metricId})`);
    }
  }
  const from = new Date(Date.parse(c.window.from) - DAY_MS).toISOString();
  const to = new Date(Date.parse(c.window.to) + DAY_MS).toISOString();
  // Parent before child: daily reads hourly.
  for (const tier of TIERS) {
    await db.execute(sql`call refresh_continuous_aggregate(
      ${sql.raw(`'${tier}'`)}, ${from}::timestamptz, ${to}::timestamptz)`);
  }
}

type Modules = {
  history: typeof import("../../src/shared/history");
  reader: typeof import("../../src/energy/rollup-reader");
  energy: typeof import("../../src/energy/energy");
  calc: typeof import("../../src/energy/energy-calc");
  periods: typeof import("../../src/energy/period-keys");
};

async function modules(): Promise<Modules> {
  return {
    history: await import("../../src/shared/history"),
    reader: await import("../../src/energy/rollup-reader"),
    energy: await import("../../src/energy/energy"),
    calc: await import("../../src/energy/energy-calc"),
    periods: await import("../../src/energy/period-keys"),
  };
}

async function rollupLine(m: Modules, c: OracleCase) {
  const tiers: Record<string, Record<string, unknown>> = {};
  for (const key of Object.keys(c.readings)) {
    tiers[key] = {};
    for (const bucket of BUCKETS) {
      tiers[key]![bucket] = await m.history.queryRollup({
        metric: key,
        inverterId: slugOf(c),
        bucket,
        from: new Date(c.window.from),
        to: new Date(c.window.to),
        limit: 100_000,
      });
    }
  }
  return {
    group: "rollups",
    case: c.id,
    doc: c.doc,
    timeZone: PLANT_TZ,
    counters: Object.keys(c.readings).filter((k) => COUNTER_KEYS.has(k)),
    window: c.window,
    readings: c.readings,
    tiers,
  };
}

/**
 * The calendar months the statistics window touches, as one `[from, to)` window: month periods the
 * window merely clips are dropped by `eachPeriod`, so monthly figures need month-aligned bounds.
 */
function monthSpan(c: OracleCase): { from: string; to: string } {
  const first = periodWindow(Date.parse(c.stat.from), PLANT_TZ, "month");
  const last = periodWindow(Date.parse(c.stat.to) - 1, PLANT_TZ, "month");
  return { from: first.start.toISOString(), to: last.end.toISOString() };
}

type Window = { from: string; to: string };

/** Per-period energy from the delta matrix, the way `energySeries` folds it. */
async function periodsOf(
  m: Modules,
  c: OracleCase,
  window: Window,
  bucket: "day" | "month",
  view: "hourly_rollups" | "daily_rollups",
) {
  const profile = profileOf(c);
  const from = new Date(window.from);
  const to = new Date(window.to);
  const { rows, fieldByKey, periods } = await m.reader.fetchCounterDeltaMatrix(profile, {
    from,
    to,
    bucket,
    inverterId: slugOf(c),
    view,
    tz: PLANT_TZ,
  });
  const totals = m.energy.accumulateTotals(rows, fieldByKey, periods);
  return { profile, periods, totals, derived: m.energy.derivePeriods(profile, periods, totals) };
}

/** Months folded into years: `derivePeriodEnergy` over the summed monthly totals. */
function yearsOf(m: Modules, months: Awaited<ReturnType<typeof periodsOf>>) {
  const byYear = new Map<string, ReturnType<typeof m.calc.emptyTotals>>();
  for (const [key, total] of months.totals) {
    const year = byYear.get(key.slice(0, 4)) ?? m.calc.emptyTotals();
    for (const field of Object.keys(year) as Array<keyof typeof year>) year[field] += total[field];
    byYear.set(key.slice(0, 4), year);
  }
  const impliedLoad = !m.reader.metersLoadEnergy(months.profile);
  return [...byYear].map(([key, total]) => m.calc.derivePeriodEnergy(key, total, { impliedLoad }));
}

async function statisticsLine(m: Modules, c: OracleCase) {
  const profile = profileOf(c);
  const hourly = await m.reader.fetchBucketEnergy(
    profile,
    slugOf(c),
    new Date(c.stat.from),
    new Date(c.stat.to),
    "hourly_rollups",
    PLANT_TZ,
  );
  const daily = await periodsOf(m, c, c.stat, "day", "daily_rollups");
  const local = await periodsOf(m, c, c.stat, "day", "hourly_rollups");
  const monthly = await periodsOf(m, c, monthSpan(c), "month", "daily_rollups");
  return {
    group: "statistics",
    case: c.id,
    doc: c.doc,
    timeZone: PLANT_TZ,
    window: c.stat,
    roles: Object.fromEntries(
      (profile.metrics as unknown as Array<{ role: string; key: string }>).map((x) => [
        x.role,
        x.key,
      ]),
    ),
    hourly: hourly.map((h) => ({ ...h, time: h.time.toISOString() })),
    daily: daily.derived,
    dailyLocal: local.derived,
    monthWindow: monthSpan(c),
    monthly: monthly.derived,
    yearly: yearsOf(m, monthly),
  };
}

/** Build `rollups.ndjson` and `statistics.ndjson`. */
export async function buildRollupAndStatistics(db: Db): Promise<Record<string, string>> {
  const m = await modules();
  const rollups = [];
  const statistics = [];
  for (const c of CASES) {
    await seedCase(db, c);
    rollups.push(await rollupLine(m, c));
    statistics.push(await statisticsLine(m, c));
  }
  return { "rollups.ndjson": ndjson(rollups), "statistics.ndjson": ndjson(statistics) };
}
