// The fake core's reads that follow the clock: history, statistics, forecasts and costs, each
// sampled from the synthetic plant over the span asked for.

import type { components } from "../src/lib/api/schema";
import { PLANT, SPOT, valueAt } from "./plant.ts";

type Schemas = components["schemas"];

/** What the core answers, as its OpenAPI document names it. */
export type Answer<Name extends keyof components["schemas"]> = components["schemas"][Name];

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** Recording began this long before the run. */
const AGE_DAYS = 400;

/** The plant's zone, and when its recording began. */
export interface Plant {
  readonly start: number;
  readonly zone: string;
  readonly offset: number;
}

export function plantNow(zone: string, offset: number): Plant {
  return { start: Date.now() - AGE_DAYS * DAY, zone, offset };
}

/** A span asked for, in epoch ms. */
export interface Span {
  readonly from: number;
  readonly to: number;
}

const iso = (t: number) => new Date(t).toISOString();

/** The time-weighted mean of one series over a span: hourly samples, or four in a short span. */
function mean(plant: Plant, device: number, series: string, span: Span): number | undefined {
  const step = Math.min(HOUR, (span.to - span.from) / 4);
  let sum = 0;
  let n = 0;

  for (let t = span.from + step / 2; t < span.to; t += step) {
    const value = valueAt(device, series, t, plant.offset);

    if (value === undefined) return undefined;

    sum += value;
    n += 1;
  }

  return n === 0 ? undefined : sum / n;
}

/** The core's tier for a span (api/history.rs): minute buckets up to a day, then hours, then days. */
function tier(span: Span) {
  const length = span.to - span.from;

  if (length <= DAY) return { tier: "bucket" as const, width: 60 };

  return length <= 1499 * HOUR
    ? { tier: "hour" as const, width: 3600 }
    : { tier: "day" as const, width: 86_400 };
}

export function history(
  plant: Plant,
  device: number,
  series: string,
  span: Span,
): Answer<"History"> {
  const { tier: name, width } = tier(span);
  const step = width * 1000;
  const points: Schemas["Point"][] = [];
  const now = Date.now();
  const first = Math.max(span.from, plant.start);

  for (let t = first - (first % step); t < Math.min(span.to, now); t += step) {
    const end = Math.min(t + step, now);
    const value = mean(plant, device, series, { from: t, to: end });

    if (value !== undefined) points.push({ start: iso(t), end: iso(end), mean: value });
  }

  return { series, tier: name, width: name === "bucket" ? width : null, points };
}

/** The plant-local period after `start`. */
function next(plant: Plant, start: number, period: Schemas["Period"]): number {
  if (period === "hour") return start + HOUR;

  if (period === "day") return start + DAY;

  if (period === "week") return start + 7 * DAY;

  const local = new Date(start + plant.offset * HOUR);

  return Date.UTC(local.getUTCFullYear(), local.getUTCMonth() + 1, 1) - plant.offset * HOUR;
}

/** One period's figures, or null before recording began. */
function figures(plant: Plant, device: number, series: string, span: Span) {
  const from = Math.max(span.from, plant.start);
  const m = span.to > from ? mean(plant, device, series, { from, to: span.to }) : undefined;

  if (m === undefined) return null;

  return {
    date: new Date(span.from + plant.offset * HOUR).toISOString().slice(0, 10),
    start: iso(span.from),
    end: iso(span.to),
    integral: (m * (span.to - from)) / HOUR,
    mean: m,
    min: 0,
    max: m * 2,
    hours: (span.to - from) / HOUR,
  };
}

export function statistics(
  plant: Plant,
  device: number,
  series: string,
  period: Answer<"Period">,
  span: Span,
): Answer<"Statistics"> {
  const points: Schemas["Figures"][] = [];
  const now = Date.now();

  for (let start = span.from; start < Math.min(span.to, now); start = next(plant, start, period)) {
    const found = figures(plant, device, series, {
      from: start,
      to: Math.min(next(plant, start, period), now),
    });

    if (found !== null) points.push(found);
  }

  return { series, period, points };
}

export function forecasts(
  plant: Plant,
  device: number,
  series: string,
  span: Span,
): Answer<"Forecasts"> {
  const points: Schemas["ForecastPoint"][] = [];
  const issued = iso(Date.now() - 6 * HOUR);

  for (let t = span.from - (span.from % HOUR); t < span.to; t += HOUR) {
    const value = valueAt(device, series, t + HOUR / 2, plant.offset);

    // Forecasts run a little over what comes; prices are what they are.
    if (value !== undefined)
      points.push({ issued, target: iso(t), value: device === SPOT ? value : value * 1.08 });
  }

  return { series, points };
}

export function costs(plant: Plant, span: Span): Answer<"CostDays"> {
  const kwh = (series: string, day: Span) =>
    ((mean(plant, PLANT, series, day) ?? 0) * (day.to - day.from)) / HOUR / 1000;

  const days: Schemas["CostDay"][] = [];
  const now = Date.now();

  for (let start = Math.max(span.from, plant.start); start < Math.min(span.to, now); start += DAY) {
    const day = { from: start, to: Math.min(start + DAY, now) };
    const paid = kwh("grid.import.power", day) * 0.32;
    const earned = kwh("grid.export.power", day) * 0.08;

    days.push({
      start: iso(day.from),
      end: iso(day.to),
      paid,
      earned,
      saved: kwh("load.power", day) * 0.32 - paid + earned,
      standing: 0,
    });
  }

  const sum = (k: "paid" | "earned" | "saved") =>
    days.reduce((a, d: Readonly<Schemas["CostDay"]>) => a + d[k], 0);

  return {
    days,
    total: { paid: sum("paid"), earned: sum("earned"), saved: sum("saved"), standing: 0 },
  };
}
