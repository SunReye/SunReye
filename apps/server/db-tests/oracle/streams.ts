/**
 * The reading streams the rollup and statistics groups of the oracle corpus start from.
 *
 * Every stream is a fixed list of `[instant, value]`: no clock, no randomness. Cumulative counters
 * are built from a rate so the energy in any bucket can be worked out by hand.
 */

export type Reading = [string, number];

/** Metric keys every case uses; counters are marked in {@link COUNTER_KEYS}. */
export const KEYS = {
  power: "oracle.power",
  import: "oracle.import.total",
  export: "oracle.export.total",
  production: "oracle.production.total",
  productionToday: "oracle.production.today",
} as const;

export const COUNTER_KEYS: ReadonlySet<string> = new Set([
  KEYS.import,
  KEYS.export,
  KEYS.production,
  KEYS.productionToday,
]);

export interface OracleCase {
  id: string;
  doc: string;
  /** UTC span the rollup tiers are read over; covers every reading. */
  window: { from: string; to: string };
  /** Plant-local day-aligned span the statistics are read over. */
  stat: { from: string; to: string };
  readings: Record<string, Reading[]>;
}

const MIN = 60_000;
const round = (x: number): number => Math.round(x * 1000) / 1000;

/** Instants from `from` to `to` inclusive, `stepMin` apart. */
function instants(from: string, to: string, stepMin: number): number[] {
  const out: number[] = [];
  for (let t = Date.parse(from); t <= Date.parse(to); t += stepMin * MIN) out.push(t);
  return out;
}

const hourOfDay = (t: number): number => new Date(t).getUTCHours();

/** kWh per hour of the roof: 2 between 06:00 and 15:00 UTC, else 0. */
const solarRate = (t: number): number => (hourOfDay(t) >= 6 && hourOfDay(t) < 15 ? 2 : 0);
const exportRate = (t: number): number => (hourOfDay(t) >= 8 && hourOfDay(t) < 14 ? 0.8 : 0);
const importRate = (): number => 0.4;

/** A counter that starts at `start` and gains `rate(t)` kWh per hour, sampled at `times`. */
function counter(
  times: number[],
  start: number,
  rate: (t: number) => number,
  stepMin: number,
): Reading[] {
  let level = start;
  return times.map((t, i) => {
    if (i > 0) level += (rate(t) * stepMin) / 60;
    return [new Date(t).toISOString(), round(level)];
  });
}

/** Readings from `"<date> HH:MM=value ..."`; a bare date token sets the day of the times after it. */
function series(spec: string): Reading[] {
  let day = "";
  return spec.split(" ").flatMap((token): Reading[] => {
    if (!token.includes("=")) {
      day = token;
      return [];
    }
    const [time, value] = token.split("=");
    return [[`${day}T${time}:00Z`, Number(value)]];
  });
}

/** A day's solar, grid import and export as hourly counters plus the roof's power. */
function energyDay(from: string, to: string, stepMin = 60): Record<string, Reading[]> {
  const times = instants(from, to, stepMin);
  return {
    [KEYS.power]: times.map((t) => [new Date(t).toISOString(), solarRate(t) * 1000]),
    [KEYS.production]: counter(times, 1000, solarRate, stepMin),
    [KEYS.import]: counter(times, 500, importRate, stepMin),
    [KEYS.export]: counter(times, 300, exportRate, stepMin),
  };
}

/**
 * Every case lies before 2026-06-01. Refreshing a continuous aggregate moves its watermark for the
 * whole database, and baseline.test.ts reads a row at 2026-06-01 through real-time aggregation,
 * which only works while nothing has been materialised past it.
 */
export const CASES: OracleCase[] = [
  {
    id: "dst-spring-2026-03-29",
    doc: "Europe/Berlin springs forward on 29 March: the local day is 23 hours, 28 March 23:00Z to 29 March 22:00Z",
    window: { from: "2026-03-27T00:00:00Z", to: "2026-03-31T00:00:00Z" },
    stat: { from: "2026-03-27T23:00:00Z", to: "2026-03-30T22:00:00Z" },
    readings: energyDay("2026-03-27T21:00:00Z", "2026-03-30T03:00:00Z"),
  },
  {
    id: "dst-autumn-2025-10-26",
    doc: "Europe/Berlin falls back on 26 October 2025: the local day is 25 hours, 25 October 22:00Z to 26 October 23:00Z",
    window: { from: "2025-10-24T00:00:00Z", to: "2025-10-28T00:00:00Z" },
    stat: { from: "2025-10-24T22:00:00Z", to: "2025-10-27T23:00:00Z" },
    readings: energyDay("2025-10-24T21:00:00Z", "2025-10-27T03:00:00Z"),
  },
  {
    id: "midnight-crossing",
    doc: "100 W held from 22:50Z and 200 W from 23:10Z straddle Berlin's winter midnight (23:00Z); counters rise across it",
    window: { from: "2026-01-14T00:00:00Z", to: "2026-01-16T00:00:00Z" },
    stat: { from: "2026-01-13T23:00:00Z", to: "2026-01-15T23:00:00Z" },
    readings: {
      [KEYS.power]: series("2026-01-14 22:50=100 23:10=200 2026-01-15 00:10=200 01:00=200"),
      [KEYS.production]: series(
        "2026-01-14 22:50=100 23:10=100.4 2026-01-15 00:10=101 01:00=101.5",
      ),
      [KEYS.import]: series("2026-01-14 22:50=50 23:10=50.2 2026-01-15 00:10=50.5 01:00=50.9"),
    },
  },
  {
    id: "counter-restart",
    doc: "the production counter restarts from 5004 to 2 inside the 12:00Z hour and keeps rising from there",
    window: { from: "2026-05-10T00:00:00Z", to: "2026-05-11T00:00:00Z" },
    stat: { from: "2026-05-09T22:00:00Z", to: "2026-05-10T22:00:00Z" },
    readings: {
      [KEYS.power]: instants("2026-05-10T08:00:00Z", "2026-05-10T15:30:00Z", 30).map((t) => [
        new Date(t).toISOString(),
        1000,
      ]),
      [KEYS.production]: instants("2026-05-10T08:00:00Z", "2026-05-10T15:30:00Z", 30).map(
        (t, i) => [new Date(t).toISOString(), i < 9 ? 5000 + i * 0.5 : 2 + (i - 9) * 0.5],
      ),
    },
  },
  {
    id: "partial-window",
    doc: "readings cover only 09:20Z to 14:40Z of the local day, 20 minutes apart; the first bucket has no predecessor",
    window: { from: "2026-05-20T00:00:00Z", to: "2026-05-21T00:00:00Z" },
    stat: { from: "2026-05-19T22:00:00Z", to: "2026-05-20T22:00:00Z" },
    readings: energyDay("2026-05-20T09:20:00Z", "2026-05-20T14:40:00Z", 20),
  },
  {
    id: "zero-and-negative",
    doc: "zero power overnight, negative grid power while exporting, counters standing still for hours",
    window: { from: "2026-02-10T00:00:00Z", to: "2026-02-11T00:00:00Z" },
    stat: { from: "2026-02-09T23:00:00Z", to: "2026-02-10T23:00:00Z" },
    readings: {
      [KEYS.power]: series("2026-02-10 00:00=0 02:00=0 04:00=-300 06:00=-1500 08:00=0 10:00=250"),
      [KEYS.import]: series(
        "2026-02-10 00:00=250 02:00=250 04:00=250 06:00=250 08:00=250 10:00=250.5",
      ),
      [KEYS.export]: series(
        "2026-02-10 00:00=80 02:00=80 04:00=80.4 06:00=81.6 08:00=81.6 10:00=81.6",
      ),
    },
  },
  {
    id: "absent-readings",
    doc: "no readings from 05:00Z to 09:00Z, longer than the 3 hours an hourly counter delta may bridge",
    window: { from: "2026-04-02T00:00:00Z", to: "2026-04-03T00:00:00Z" },
    stat: { from: "2026-04-01T22:00:00Z", to: "2026-04-02T22:00:00Z" },
    readings: Object.fromEntries(
      Object.entries(energyDay("2026-04-02T00:00:00Z", "2026-04-02T12:00:00Z")).map(
        ([key, rows]) => [
          key,
          rows.filter(
            ([iso]) =>
              Date.parse(iso) < Date.parse("2026-04-02T06:00:00Z") ||
              Date.parse(iso) >= Date.parse("2026-04-02T09:00:00Z"),
          ),
        ],
      ),
    ),
  },
  {
    id: "stale-across-midnight",
    doc: "the last reading of the evening (19:30Z, 250 W) is the only one until 05:15Z the next morning, past Berlin's midnight at 22:00Z",
    window: { from: "2026-04-12T00:00:00Z", to: "2026-04-14T00:00:00Z" },
    stat: { from: "2026-04-11T22:00:00Z", to: "2026-04-13T22:00:00Z" },
    readings: {
      [KEYS.power]: series(
        "2026-04-12 18:30=400 19:00=300 19:30=250 2026-04-13 05:15=100 05:45=600",
      ),
      [KEYS.import]: series(
        "2026-04-12 18:30=700 19:00=700.2 19:30=700.4 2026-04-13 05:15=704.1 05:45=704.3",
      ),
    },
  },
  {
    id: "day-register-reset",
    doc: "a production.today register falls to 0 at Berlin's midnight (22:00Z in summer); its lifetime twin keeps rising",
    window: { from: "2026-04-09T00:00:00Z", to: "2026-04-11T00:00:00Z" },
    stat: { from: "2026-04-08T22:00:00Z", to: "2026-04-10T22:00:00Z" },
    readings: {
      [KEYS.productionToday]: series(
        "2026-04-09 19:00=15 20:00=16.5 21:00=17.8 22:00=0 23:00=0.4 2026-04-10 00:00=0.9 01:00=1.5",
      ),
      [KEYS.production]: series(
        "2026-04-09 19:00=3000 20:00=3001.5 21:00=3002.8 22:00=3002.8 23:00=3003.2 2026-04-10 00:00=3003.7 01:00=3004.3",
      ),
    },
  },
  {
    id: "year-boundary",
    doc: "three days across New Year in Berlin (31 December 23:00Z): months and years split inside the window",
    window: { from: "2025-12-29T00:00:00Z", to: "2026-01-03T00:00:00Z" },
    stat: { from: "2025-12-29T23:00:00Z", to: "2026-01-02T23:00:00Z" },
    readings: energyDay("2025-12-30T12:00:00Z", "2026-01-02T12:00:00Z"),
  },
  {
    id: "spurious-low-read",
    doc: "one import sample reads 99.9 between readings of 250: the figure falls with it and the next bucket books the rise back",
    window: { from: "2026-03-05T00:00:00Z", to: "2026-03-06T00:00:00Z" },
    stat: { from: "2026-03-04T23:00:00Z", to: "2026-03-05T23:00:00Z" },
    readings: {
      [KEYS.import]: series("2026-03-05 05:00=250 06:00=250.2 07:00=99.9 08:00=250.4 09:00=250.6"),
    },
  },
];
