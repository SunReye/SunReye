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

const stamp = (pairs: [string, number][]): Reading[] => pairs;

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

export const CASES: OracleCase[] = [
  {
    id: "dst-spring-2026-03-29",
    doc: "Europe/Berlin springs forward on 29 March: the local day is 23 hours, 28 March 23:00Z to 29 March 22:00Z",
    window: { from: "2026-03-27T00:00:00Z", to: "2026-03-31T00:00:00Z" },
    stat: { from: "2026-03-27T23:00:00Z", to: "2026-03-30T22:00:00Z" },
    readings: energyDay("2026-03-27T21:00:00Z", "2026-03-30T03:00:00Z"),
  },
  {
    id: "dst-autumn-2026-10-25",
    doc: "Europe/Berlin falls back on 25 October: the local day is 25 hours, 24 October 22:00Z to 25 October 23:00Z",
    window: { from: "2026-10-23T00:00:00Z", to: "2026-10-27T00:00:00Z" },
    stat: { from: "2026-10-23T22:00:00Z", to: "2026-10-26T23:00:00Z" },
    readings: energyDay("2026-10-23T21:00:00Z", "2026-10-26T03:00:00Z"),
  },
  {
    id: "midnight-crossing",
    doc: "100 W held from 22:50Z and 200 W from 23:10Z straddle Berlin's winter midnight (23:00Z); counters rise across it",
    window: { from: "2026-01-14T00:00:00Z", to: "2026-01-16T00:00:00Z" },
    stat: { from: "2026-01-13T23:00:00Z", to: "2026-01-15T23:00:00Z" },
    readings: {
      [KEYS.power]: stamp([
        ["2026-01-14T22:50:00Z", 100],
        ["2026-01-14T23:10:00Z", 200],
        ["2026-01-15T00:10:00Z", 200],
        ["2026-01-15T01:00:00Z", 200],
      ]),
      [KEYS.production]: stamp([
        ["2026-01-14T22:50:00Z", 100],
        ["2026-01-14T23:10:00Z", 100.4],
        ["2026-01-15T00:10:00Z", 101],
        ["2026-01-15T01:00:00Z", 101.5],
      ]),
      [KEYS.import]: stamp([
        ["2026-01-14T22:50:00Z", 50],
        ["2026-01-14T23:10:00Z", 50.2],
        ["2026-01-15T00:10:00Z", 50.5],
        ["2026-01-15T01:00:00Z", 50.9],
      ]),
    },
  },
  {
    id: "counter-restart",
    doc: "the production counter restarts from 5004 to 2 inside the 12:00Z hour and keeps rising from there",
    window: { from: "2026-06-10T00:00:00Z", to: "2026-06-11T00:00:00Z" },
    stat: { from: "2026-06-09T22:00:00Z", to: "2026-06-10T22:00:00Z" },
    readings: {
      [KEYS.power]: instants("2026-06-10T08:00:00Z", "2026-06-10T15:30:00Z", 30).map((t) => [
        new Date(t).toISOString(),
        1000,
      ]),
      [KEYS.production]: instants("2026-06-10T08:00:00Z", "2026-06-10T15:30:00Z", 30).map(
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
      [KEYS.power]: stamp([
        ["2026-02-10T00:00:00Z", 0],
        ["2026-02-10T02:00:00Z", 0],
        ["2026-02-10T04:00:00Z", -300],
        ["2026-02-10T06:00:00Z", -1500],
        ["2026-02-10T08:00:00Z", 0],
        ["2026-02-10T10:00:00Z", 250],
      ]),
      [KEYS.import]: stamp([
        ["2026-02-10T00:00:00Z", 250],
        ["2026-02-10T02:00:00Z", 250],
        ["2026-02-10T04:00:00Z", 250],
        ["2026-02-10T06:00:00Z", 250],
        ["2026-02-10T08:00:00Z", 250],
        ["2026-02-10T10:00:00Z", 250.5],
      ]),
      [KEYS.export]: stamp([
        ["2026-02-10T00:00:00Z", 80],
        ["2026-02-10T02:00:00Z", 80],
        ["2026-02-10T04:00:00Z", 80.4],
        ["2026-02-10T06:00:00Z", 81.6],
        ["2026-02-10T08:00:00Z", 81.6],
        ["2026-02-10T10:00:00Z", 81.6],
      ]),
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
    window: { from: "2026-08-12T00:00:00Z", to: "2026-08-14T00:00:00Z" },
    stat: { from: "2026-08-11T22:00:00Z", to: "2026-08-13T22:00:00Z" },
    readings: {
      [KEYS.power]: stamp([
        ["2026-08-12T18:30:00Z", 400],
        ["2026-08-12T19:00:00Z", 300],
        ["2026-08-12T19:30:00Z", 250],
        ["2026-08-13T05:15:00Z", 100],
        ["2026-08-13T05:45:00Z", 600],
      ]),
      [KEYS.import]: stamp([
        ["2026-08-12T18:30:00Z", 700],
        ["2026-08-12T19:00:00Z", 700.2],
        ["2026-08-12T19:30:00Z", 700.4],
        ["2026-08-13T05:15:00Z", 704.1],
        ["2026-08-13T05:45:00Z", 704.3],
      ]),
    },
  },
  {
    id: "day-register-reset",
    doc: "a production.today register falls to 0 at Berlin's midnight (22:00Z in summer); its lifetime twin keeps rising",
    window: { from: "2026-09-09T00:00:00Z", to: "2026-09-11T00:00:00Z" },
    stat: { from: "2026-09-08T22:00:00Z", to: "2026-09-10T22:00:00Z" },
    readings: {
      [KEYS.productionToday]: stamp([
        ["2026-09-09T19:00:00Z", 15],
        ["2026-09-09T20:00:00Z", 16.5],
        ["2026-09-09T21:00:00Z", 17.8],
        ["2026-09-09T22:00:00Z", 0],
        ["2026-09-09T23:00:00Z", 0.4],
        ["2026-09-10T00:00:00Z", 0.9],
        ["2026-09-10T01:00:00Z", 1.5],
      ]),
      [KEYS.production]: stamp([
        ["2026-09-09T19:00:00Z", 3000],
        ["2026-09-09T20:00:00Z", 3001.5],
        ["2026-09-09T21:00:00Z", 3002.8],
        ["2026-09-09T22:00:00Z", 3002.8],
        ["2026-09-09T23:00:00Z", 3003.2],
        ["2026-09-10T00:00:00Z", 3003.7],
        ["2026-09-10T01:00:00Z", 3004.3],
      ]),
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
      [KEYS.import]: stamp([
        ["2026-03-05T05:00:00Z", 250],
        ["2026-03-05T06:00:00Z", 250.2],
        ["2026-03-05T07:00:00Z", 99.9],
        ["2026-03-05T08:00:00Z", 250.4],
        ["2026-03-05T09:00:00Z", 250.6],
      ]),
    },
  },
];
