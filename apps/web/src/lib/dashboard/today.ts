// What the dashboard says of today (ADR 21), from the core's rollups, history and forecasts. Pure.

const HOUR = 3_600_000;

/** A time-weighted mean over a span, as the core's history reads it. */
export interface Interval {
  readonly start: string;
  readonly end: string;
  readonly mean: number;
}

export type Peak = { readonly watts: number; readonly at: Readonly<Date> } | null;

/** A power's highest mean over its intervals, and when it began. */
export function peak(intervals: readonly Interval[]): Peak {
  let top: Peak = null;

  for (const { start, mean } of intervals)
    if (top === null || mean > top.watts) top = { watts: mean, at: new Date(start) };

  return top;
}

/** Today's energy in kWh, and the two meters in percent; a meter is null with nothing to measure. */
export interface Today {
  readonly production: number;
  readonly consumption: number;
  readonly feedIn: number;
  readonly purchase: number;
  readonly autarky: number | null;
  readonly selfUse: number | null;
  readonly peaks: { readonly production: Peak; readonly consumption: Peak };
}

/** The day's energy in kWh of each `plant` series (ADR 4, 14), as the core rolled it up. */
export interface Energies {
  readonly "pv.power": number;
  readonly "load.power": number;
  readonly "grid.import.power": number;
  readonly "grid.export.power": number;
  readonly "self.consumption.power": number;
  readonly "self.supply.power": number;
}

const share = (part: number, whole: number): number | null =>
  whole > 0 ? Math.min(Math.max(part / whole, 0), 1) * 100 : null;

/** The four figures and the two meters, from the `plant` device's day rollups. */
export function today(energies: Readonly<Energies>, peaks: Today["peaks"]): Today {
  return {
    production: energies["pv.power"],
    consumption: energies["load.power"],
    feedIn: energies["grid.export.power"],
    purchase: energies["grid.import.power"],
    // Autarky: the house load not bought. Self-consumption: the PV not fed in.
    autarky: share(energies["self.supply.power"], energies["load.power"]),
    selfUse: share(energies["self.consumption.power"], energies["pv.power"]),
    peaks,
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
