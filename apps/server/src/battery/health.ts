/**
 * The database-bound half of battery health: read the raw series, measure the
 * discharge segments in it, persist one estimate per segment, and summarise the
 * stored estimates into a capacity and an SOH.
 *
 * The measuring itself is pure and lives in `./capacity-estimate`. This module
 * only moves rows.
 *
 * Reads come from `metrics_raw` rather than a rollup on purpose. A stored row is
 * an interval carrying its own `dur_ms`, so the energy integral is exact; a
 * minute bucket would have already averaged away the thing being integrated.
 * With raw retention now measured in years, the same code re-scores the whole
 * history — which is what makes a degradation curve available immediately
 * rather than in six months.
 */

import { db } from "@SunReye/db";
import { batteryCapacityEstimates } from "@SunReye/db/schema/battery-health";
import { metricsRaw } from "@SunReye/db/schema/metrics";
import { metricKeys } from "@SunReye/db/schema/plants";
import { and, asc, eq, gte, inArray, lt } from "drizzle-orm";
import { deviceIdOf } from "../shared/identity-sql";
import {
  type DischargeSegment,
  type HealthSummary,
  type PowerInterval,
  type SocSample,
  dischargeSegments,
  dischargeSign,
  summariseEstimates,
} from "./capacity-estimate";

/** The metric keys this reads, resolved from the active profile's roles. */
export interface BatteryKeys {
  soc: string;
  power: string;
  temperature?: string | undefined;
}

/** How far back {@link batteryHealthSummary} looks for the CURRENT capacity. */
const RECENT_WINDOW_DAYS = 180;

/**
 * Read the SOC, power and temperature series for one window.
 *
 * `dur_ms` may be null on rows written before the storage rewrite; those are
 * read as one shipped poll interval, the same constant the weighted aggregates
 * use, so a pre-rewrite day integrates to the same energy it always did.
 */
async function readSeries(
  inverterId: string,
  from: Date,
  to: Date,
  keys: BatteryKeys,
): Promise<{ soc: SocSample[]; power: PowerInterval[]; temperature: PowerInterval[] }> {
  const wanted = [keys.soc, keys.power, ...(keys.temperature ? [keys.temperature] : [])];
  // `metric_keys` is JOINED rather than resolved to a set of ids in process,
  // because the loop below DISPATCHES on the metric name — the key is data here,
  // not just a filter, and the int2 would have to be mapped back anyway.
  const rows = await db
    .select({
      metric: metricKeys.key,
      time: metricsRaw.time,
      value: metricsRaw.value,
      durMs: metricsRaw.durMs,
    })
    .from(metricsRaw)
    .innerJoin(metricKeys, eq(metricKeys.id, metricsRaw.metricId))
    .where(
      and(
        eq(metricsRaw.deviceId, deviceIdOf(inverterId)),
        inArray(metricKeys.key, wanted),
        gte(metricsRaw.time, from),
        lt(metricsRaw.time, to),
      ),
    )
    .orderBy(asc(metricsRaw.time));

  const soc: SocSample[] = [];
  const power: PowerInterval[] = [];
  const temperature: PowerInterval[] = [];
  for (const row of rows) {
    const t = row.time.getTime();
    const durMs = row.durMs ?? 1000;
    if (row.metric === keys.soc) soc.push({ t, soc: row.value });
    else if (row.metric === keys.power) power.push({ t, durMs, w: row.value });
    else temperature.push({ t, durMs, w: row.value });
  }
  return { soc, power, temperature };
}

/**
 * Measure the discharge segments in one window.
 *
 * The power series is normalised so positive means discharging, using the sign
 * the DATA reports rather than a convention — see {@link dischargeSign}. When
 * the window cannot say which way the sign points, there is nothing to measure
 * and the answer is no segments, never a guess.
 */
export async function measureSegments(
  inverterId: string,
  from: Date,
  to: Date,
  keys: BatteryKeys,
): Promise<DischargeSegment[]> {
  const { soc, power, temperature } = await readSeries(inverterId, from, to, keys);
  const sign = dischargeSign(soc, power);
  if (sign === null) return [];
  const normalised = sign === 1 ? power : power.map((i) => ({ ...i, w: -i.w }));
  return dischargeSegments(soc, normalised, temperature.length > 0 ? { temperature } : {});
}

/**
 * Persist one estimate per segment. Idempotent: the segment's end instant is
 * the key, so re-running a backfill over a window already scored inserts
 * nothing and a widened window inserts only what is new.
 */
export async function recordSegments(
  inverterId: string,
  segments: readonly DischargeSegment[],
): Promise<number> {
  if (segments.length === 0) return 0;
  const device = deviceIdOf(inverterId);
  const rows = segments.map((s) => ({
    // The id as a SQL sub-select rather than an awaited number: an estimate is
    // written once per discharge segment (a handful a day), so the sub-select
    // costs nothing, and this way the module keeps its name-shaped signature.
    deviceId: device,
    measuredAt: new Date(s.endMs),
    startedAt: new Date(s.startMs),
    socStart: s.socStart,
    socEnd: s.socEnd,
    energyKwh: s.energyKwh,
    capacityKwh: s.energyKwh / (s.deltaSoc / 100),
    tempC: s.meanTempC ?? null,
  }));
  // `returning()` so the count is rows actually INSERTED, not rows offered. A
  // re-score over a window already measured conflicts on every row, and a
  // caller told "stored 12" when it stored none cannot tell a working backfill
  // from one that silently found nothing new.
  const inserted = await db
    .insert(batteryCapacityEstimates)
    .values(rows)
    .onConflictDoNothing()
    .returning({ measuredAt: batteryCapacityEstimates.measuredAt });
  return inserted.length;
}

/** A stored estimate, in the shape {@link estimateCapacity} consumes. */
function asSegment(row: {
  startedAt: Date;
  measuredAt: Date;
  socStart: number;
  socEnd: number;
  energyKwh: number;
}): DischargeSegment {
  return {
    startMs: row.startedAt.getTime(),
    endMs: row.measuredAt.getTime(),
    socStart: row.socStart,
    socEnd: row.socEnd,
    deltaSoc: row.socStart - row.socEnd,
    energyKwh: row.energyKwh,
  };
}

export interface BatteryHealth extends HealthSummary {
  /** Every stored estimate, oldest first — the degradation series. */
  trend: Array<{ measuredAt: string; capacityKwh: number; tempC: number | null }>;
}

/** Summarise the stored estimates for one inverter. */
export async function batteryHealthSummary(
  inverterId: string,
  opts: { nameplateKwh?: number | null; now?: Date } = {},
): Promise<BatteryHealth> {
  const rows = await db
    .select()
    .from(batteryCapacityEstimates)
    .where(eq(batteryCapacityEstimates.deviceId, deviceIdOf(inverterId)))
    .orderBy(asc(batteryCapacityEstimates.measuredAt));

  const summary = summariseEstimates(
    rows.map((r) => ({ measuredAtMs: r.measuredAt.getTime(), segment: asSegment(r) })),
    {
      nameplateKwh: opts.nameplateKwh ?? null,
      nowMs: (opts.now ?? new Date()).getTime(),
      recentWindowMs: RECENT_WINDOW_DAYS * 86_400_000,
    },
  );
  return {
    ...summary,
    trend: rows.map((r) => ({
      measuredAt: r.measuredAt.toISOString(),
      capacityKwh: r.capacityKwh,
      tempC: r.tempC,
    })),
  };
}
