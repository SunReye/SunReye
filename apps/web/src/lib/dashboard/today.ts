// What the dashboard says of today (ADR 21), from the core's history and forecasts. Pure.

const HOUR = 3_600_000;

/** A time-weighted mean over a span, as the core's history reads it. */
export interface Interval {
  readonly start: string;
  readonly end: string;
  readonly mean: number;
}

export interface Flowed {
  /** kWh while the power was positive. */
  readonly positive: number;
  /** kWh while it was negative, as a positive number. */
  readonly negative: number;
  readonly peak: { readonly watts: number; readonly at: Readonly<Date> } | null;
}

/** A power's energy each way over its intervals; a gap has no interval, so it adds none. */
export function energy(intervals: readonly Interval[]): Flowed {
  let positive = 0;
  let negative = 0;
  let peak: Flowed["peak"] = null;

  for (const { start, end, mean } of intervals) {
    const from = Date.parse(start);
    const kwh = (mean * (Date.parse(end) - from)) / HOUR / 1000;

    if (kwh > 0) positive += kwh;
    else negative -= kwh;

    if (peak === null || mean > peak.watts) peak = { watts: mean, at: new Date(from) };
  }

  return { positive, negative, peak };
}

/** Today's energy in kWh, and the two meters in percent; a meter is null with nothing to measure. */
export interface Today {
  readonly production: number;
  readonly consumption: number;
  readonly feedIn: number;
  readonly purchase: number;
  readonly autarky: number | null;
  readonly selfUse: number | null;
  readonly peaks: { readonly production: Flowed["peak"]; readonly consumption: Flowed["peak"] };
}

const share = (part: number, whole: number): number | null =>
  whole > 0 ? Math.min(Math.max(1 - part / whole, 0), 1) * 100 : null;

/** From the `plant` device's `pv.power`, `load.power` and `grid.power` (ADR 4, 14). */
export function today({
  pv,
  load,
  grid,
}: {
  readonly pv: Flowed;
  readonly load: Flowed;
  readonly grid: Flowed;
}): Today {
  return {
    production: pv.positive,
    consumption: load.positive,
    feedIn: grid.negative,
    purchase: grid.positive,
    // The house's share not bought, and the PV's share not fed in.
    autarky: share(grid.positive, load.positive),
    selfUse: share(grid.negative, pv.positive),
    peaks: { production: pv.peak, consumption: load.peak },
  };
}

/** One forecast target's value, as the core's forecasts read it. */
export interface Target {
  readonly target: string;
  readonly value: number;
}

/** The plant's forecast: each inverter's `pv.power` summed at its targets (ADR 17). */
export function combined(inverters: readonly (readonly Target[])[]): Target[] {
  const sums = new Map<string, number>();

  for (const target of inverters.flat())
    sums.set(target.target, (sums.get(target.target) ?? 0) + target.value);

  return [...sums.keys()]
    .toSorted((a, b) => Date.parse(a) - Date.parse(b))
    .map((target) => ({ target, value: sums.get(target) ?? 0 }));
}

/** Each target's value holds until the next; the last for as long as the one before it. */
function slots(targets: readonly Target[]) {
  const QUARTER = HOUR / 4;

  return targets.map((point, i) => {
    const start = Date.parse(point.target);
    const next = targets[i + 1];
    const before = targets[i - 1];

    const width =
      next === undefined
        ? before === undefined
          ? QUARTER
          : start - Date.parse(before.target)
        : Date.parse(next.target) - start;

    return { start, end: start + width, watts: point.value };
  });
}

/** The day's forecast PV in kWh, and what of it is still to come. */
export interface ForecastPv {
  readonly total: number;
  readonly remaining: number;
}

/** The forecast PV over `targets`, and what of it comes after `now`. */
export function forecastPv(targets: readonly Target[], now: Readonly<Date>): ForecastPv {
  let total = 0;
  let remaining = 0;

  for (const { start, end, watts } of slots(targets)) {
    const kwh = (hours: number) => (watts * hours) / HOUR / 1000;

    total += kwh(end - start);
    remaining += kwh(Math.max(end - Math.max(start, now.getTime()), 0));
  }

  return { total, remaining };
}

/** One quarter hour of the day chart, in kW; null where there is nothing to draw. */
export interface DayRow {
  readonly time: Date;
  readonly actual: number | null;
  readonly forecast: number | null;
}

/** The day's PV per quarter hour from `day.start` to `day.end`: measured means against the forecast. */
export function dayRows(
  actual: readonly Interval[],
  forecast: readonly Target[],
  day: { readonly start: Readonly<Date>; readonly end: Readonly<Date> },
): DayRow[] {
  const QUARTER = HOUR / 4;
  const forecasts = new Map(forecast.map((t) => [Date.parse(t.target), t.value / 1000]));
  const spans = actual.map((a) => ({ ...a, from: Date.parse(a.start), to: Date.parse(a.end) }));
  const rows: DayRow[] = [];

  for (let start = day.start.getTime(); start < day.end.getTime(); start += QUARTER) {
    const end = start + QUARTER;
    let weighted = 0;
    let held = 0;

    for (const { from, to, mean } of spans) {
      const overlap = Math.min(to, end) - Math.max(from, start);

      if (overlap > 0) {
        weighted += mean * overlap;
        held += overlap;
      }
    }

    rows.push({
      time: new Date(start),
      actual: held > 0 ? weighted / held / 1000 : null,
      forecast: forecasts.get(start) ?? null,
    });
  }

  return rows;
}
