/**
 * COUNTER ARITHMETIC: how much energy a monotonic register recorded, when the
 * register does not stay monotonic.
 *
 * An inverter's energy counters reset — the day registers at every local
 * midnight, and a lifetime register whenever the unit loses its accumulated
 * total. `max - min` over a bucket that straddles a reset reports the whole
 * lifetime total as one bucket's energy: measured on the addon-1.2.0 fixture,
 * 64,280.971 kWh where the truth is 41.971 kWh, a factor of 1532. That single
 * number is why 2.0.0's aggregates carry a `counter_agg` partial and read energy
 * through `delta()`.
 *
 * This module is the REFERENCE implementation of that arithmetic in TypeScript —
 * the same rule `counter_agg` applies, expressed where it can be unit-tested and
 * where a test can compute an expected answer WITHOUT asking the database that is
 * under test. It has three consumers and they all need to agree:
 *
 *  1. `scripts/fixture-1-2-0.ts`, which records the committed ground truth
 *     (counter-aware AND naive, side by side, so a regression is visible);
 *  2. `apps/server/db-tests/replay.test.ts`, which asserts a replayed series
 *     still yields the same per-day energy;
 *  3. `scripts/replay-rehearsal.ts`, which compares a 2.0.0 database against
 *     that committed ground truth.
 *
 * It lives here, in the database package, rather than beside any one of them
 * because a second implementation of "how much energy did this counter record" is
 * exactly the drift that lets a migration lose two months of history quietly.
 *
 * Pure: no database, no clock, no I/O.
 */

export type EnergyRow = {
  metric: string;
  /** UTC calendar day, `YYYY-MM-DD`, matching `time_bucket('1 day', time)`. */
  day: string;
  /** Counter-aware total: the sum of increments, resets handled. */
  energy: number;
  /** What `max - min` says. Kept beside the truth so a regression is visible. */
  naive: number;
  resets: number;
};

export type RestartRow = {
  metric: string;
  at: string;
  valueBefore: number;
  valueAfter: number;
};

export type CounterReading = { metric: string; time: string; value: number };

/**
 * One counter step's contribution.
 *
 * A counter that went backwards has reset, and the increment since the reset is
 * whatever the counter now reads — the same rule `counter_agg` applies, and the
 * reason the new schema uses it. Clamped at zero so a negative reading (a
 * garbled register) contributes nothing rather than subtracting energy.
 */
export function counterIncrement(prev: number, next: number): number {
  // Both ends are clamped first: an energy counter cannot be negative, so a
  // negative reading is a garbled register, and it must contribute nothing
  // rather than manufacturing energy on the way back up to zero.
  const from = Math.max(0, prev);
  const to = Math.max(0, next);
  return to < from ? to : to - from;
}

const utcDay = (time: string) => new Date(time).toISOString().slice(0, 10);

/** Readings grouped by metric and sorted by time. Input order is not trusted. */
function byMetric(rows: readonly CounterReading[]): Map<string, CounterReading[]> {
  const groups = new Map<string, CounterReading[]>();
  for (const row of rows) {
    const list = groups.get(row.metric);
    if (list) list.push(row);
    else groups.set(row.metric, [row]);
  }
  for (const list of groups.values()) {
    list.sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
  }
  return groups;
}

/**
 * Per-metric, per-UTC-day energy, counter-aware — plus the naive `max - min`
 * for the same day, so the file records the size of the error rather than
 * asserting it in prose.
 *
 * A step is attributed to the day of its LATER reading, which is what makes a
 * reading stale across midnight behave: the increment earned overnight lands on
 * the day it was observed, exactly as `time_bucket` would place it. A day
 * therefore only appears once it has a delta to attribute; a lone reading
 * contributes nothing, which is correct rather than zero-with-a-day-row.
 */
export function perDayEnergy(rows: readonly CounterReading[]): EnergyRow[] {
  const out: EnergyRow[] = [];
  for (const [metric, list] of byMetric(rows)) {
    const days = incrementsByDay(metric, list);
    const naive = naiveByDay(list);
    for (const row of days.values()) row.naive = naive.get(row.day) ?? 0;
    out.push(...days.values());
  }
  return out.sort((a, b) => a.metric.localeCompare(b.metric) || a.day.localeCompare(b.day));
}

/** The counter-aware total, one row per day that has a step to attribute. */
function incrementsByDay(metric: string, list: readonly CounterReading[]): Map<string, EnergyRow> {
  const days = new Map<string, EnergyRow>();
  for (let i = 1; i < list.length; i++) {
    const prev = list[i - 1] as CounterReading;
    const next = list[i] as CounterReading;
    const day = utcDay(next.time);
    let row = days.get(day);
    if (!row) {
      row = { metric, day, energy: 0, naive: 0, resets: 0 };
      days.set(day, row);
    }
    row.energy += counterIncrement(prev.value, next.value);
    if (next.value < prev.value) row.resets += 1;
  }
  return days;
}

/**
 * `max - min` per day: what a bucket of avg/max/min can express, and what a
 * reset makes catastrophically wrong. Recorded, not asserted away.
 */
function naiveByDay(list: readonly CounterReading[]): Map<string, number> {
  const values = new Map<string, { min: number; max: number }>();
  for (const reading of list) {
    const day = utcDay(reading.time);
    const seen = values.get(day);
    if (!seen) values.set(day, { min: reading.value, max: reading.value });
    else {
      seen.min = Math.min(seen.min, reading.value);
      seen.max = Math.max(seen.max, reading.value);
    }
  }
  return new Map([...values].map(([day, { min, max }]) => [day, max - min]));
}

/** Every point where a counter went backwards, with the naive error it causes. */
export function describeRestarts(rows: readonly CounterReading[]): RestartRow[] {
  const out: RestartRow[] = [];
  for (const [metric, list] of byMetric(rows)) {
    for (let i = 1; i < list.length; i++) {
      const prev = list[i - 1] as CounterReading;
      const next = list[i] as CounterReading;
      if (next.value < prev.value) {
        out.push({
          metric,
          at: new Date(next.time).toISOString(),
          valueBefore: prev.value,
          valueAfter: next.value,
        });
      }
    }
  }
  return out.sort((a, b) => a.metric.localeCompare(b.metric) || a.at.localeCompare(b.at));
}

/** One counter row as a driver hands it back: the instant, and the reading. */
export interface CounterRow {
  time: Date | string;
  value: number;
}

/**
 * One metric's per-day energy and its restarts, from rows read in time order.
 *
 * The three consumers above all do exactly this — read a counter's rows, name
 * the metric, normalize the timestamp, then run both analyses over the result —
 * and they were doing it three times. Their queries differ (`metrics_raw` keyed
 * by text in 1.2.0, by `(device_id, metric_id)` in 2.0.0), which is why the
 * QUERY stays with each caller and only the mapping lives here.
 *
 * `rows` must already be ordered by time; both analyses sort defensively, so an
 * unordered input is merely slower rather than wrong.
 */
export function energyOf(
  metric: string,
  rows: readonly CounterRow[],
): { energy: EnergyRow[]; restarts: RestartRow[] } {
  const readings: CounterReading[] = rows.map((row) => ({
    metric,
    time: new Date(row.time).toISOString(),
    value: row.value,
  }));
  return { energy: perDayEnergy(readings), restarts: describeRestarts(readings) };
}
