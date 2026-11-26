import { expect, test } from "bun:test";
import type { History, Problem, Statistics } from "../api/core.ts";
import { perSeries } from "../api/core.harness.ts";
import type { Chosen } from "./picker.ts";
import { expired, readSeries, type Reads } from "./read.ts";

type Kind = Chosen["kind"];

const series = (kind: Kind, first = "2020-01-01T00:00:00Z") => ({
  ref: { device: 3, series: "x" },
  kind,
  first,
});

const DAY = [new Date("2026-11-10T00:00:00Z"), new Date("2026-11-11T00:00:00Z")] as const;
const WEEK = [new Date("2026-11-09T00:00:00Z"), new Date("2026-11-16T00:00:00Z")] as const;
const QUARTER = [new Date("2026-08-01T00:00:00Z"), new Date("2026-11-01T00:00:00Z")] as const;

const H = (hour: number) => `2026-11-10T${String(hour).padStart(2, "0")}:00:00Z`;
const ms = (hour: number) => Date.parse(H(hour));

/** One series' answer, before the core names it. */
type Unnamed<T> = Omit<T, "series">;

const RAW: Unnamed<History> = {
  tier: "raw",
  points: [
    { start: H(0), end: H(2), mean: 5 },
    { start: H(2), end: H(3), mean: 7 },
  ],
};

const figure = (hour: number, more: Partial<Statistics["points"][number]>) => ({
  date: "2026-11-10",
  start: H(hour),
  end: H(hour + 1),
  ...more,
});

const MEANS: Unnamed<Statistics> = {
  period: "hour",
  points: [
    figure(0, { mean: 10, min: 4, max: 21 }),
    figure(1, { hours: 0 }),
    figure(2, { mean: 12, min: 9, max: 13 }),
  ],
};

const DELTAS: Unnamed<Statistics> = {
  period: "hour",
  points: [figure(0, { delta: 1.5 }), figure(1, { delta: 0 })],
};

const NONE: Unnamed<Statistics> = { period: "hour", points: [] };

/** A core answering every read alike, and the reads it was asked. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- the core's own answers.
function core(answers: {
  history?: Unnamed<History> | Problem;
  statistics?: Unnamed<Statistics> | Problem;
}) {
  const asked: string[] = [];

  const reads: Reads = {
    history: perSeries((device, name, from: Date, to: Date) => {
      asked.push(`history ${device} ${name} ${from.toISOString()} ${to.toISOString()}`);

      return answers.history ?? { tier: "raw" as const, points: [] };
    }),
    statistics: perSeries((_device, _name, period: Statistics["period"]) => {
      asked.push(`statistics ${period}`);

      return answers.statistics ?? NONE;
    }),
  };

  return { reads, asked };
}

test("a measurement up to a day is a line of its history", async () => {
  const { reads, asked } = core({ history: RAW });
  const got = await readSeries(reads, series("measurement"), ...DAY);

  expect(asked).toEqual(["history 3 x 2026-11-10T00:00:00.000Z 2026-11-11T00:00:00.000Z"]);
  expect(got).toEqual({
    curve: {
      draw: "line",
      tier: "raw",
      samples: [
        { t0: ms(0), t1: ms(2), v: 5 },
        { t0: ms(2), t1: ms(3), v: 7 },
      ],
    },
    hourly: false,
    trouble: null,
  });
});

test("minute means keep their bucket's width, as the export names its tier", async () => {
  const { reads } = core({
    history: { tier: "bucket", width: 60, points: [{ start: H(0), end: H(1), mean: 5 }] },
  });

  const got = await readSeries(reads, series("measurement"), ...DAY);

  expect(got.curve).toEqual({
    draw: "line",
    tier: "bucket",
    width: 60,
    samples: [{ t0: ms(0), t1: ms(1), v: 5 }],
  });
});

test("past a day a measurement is its hourly statistics: the mean with its extremes", async () => {
  const { reads, asked } = core({ statistics: MEANS });
  const { curve } = await readSeries(reads, series("measurement"), ...WEEK);

  expect(asked).toEqual(["statistics hour"]);
  expect(curve).toEqual({
    draw: "line",
    tier: "hour",
    // An hour without a value is a gap.
    samples: [
      { t0: ms(0), t1: ms(1), v: 10, lo: 4, hi: 21 },
      { t0: ms(2), t1: ms(3), v: 12, lo: 9, hi: 13 },
    ],
  });
});

test("past the hours' cap statistics are daily", async () => {
  const { reads, asked } = core({ statistics: { ...MEANS, period: "day" } });
  const { curve } = await readSeries(reads, series("measurement"), ...QUARTER);

  expect(asked).toEqual(["statistics day"]);
  expect(curve.tier).toBe("day");
});

test("a 25-hour day is past a day: it reads statistics, as the core would refuse or roll it", async () => {
  // Europe/Berlin, 25 October 2026.
  const { reads, asked } = core({ statistics: DELTAS });

  await readSeries(
    reads,
    series("counter"),
    new Date("2026-10-24T22:00:00Z"),
    new Date("2026-10-25T23:00:00Z"),
  );

  expect(asked).toEqual(["statistics hour"]);
});

test("a counter up to a day is a step line of its readings", async () => {
  const { reads } = core({ history: RAW });
  const { curve } = await readSeries(reads, series("counter"), ...DAY);

  expect(curve.draw).toBe("step");
  expect(curve.samples).toHaveLength(2);
});

test("past a day a counter is bars of its deltas, hourly then daily", async () => {
  const hourly = core({ statistics: DELTAS });
  const daily = core({ statistics: { ...DELTAS, period: "day" } });
  const { curve } = await readSeries(hourly.reads, series("counter"), ...WEEK);

  expect(curve).toEqual({
    draw: "bars",
    tier: "hour",
    samples: [
      { t0: ms(0), t1: ms(1), v: 1.5 },
      { t0: ms(1), t1: ms(2), v: 0 },
    ],
  });

  expect((await readSeries(daily.reads, series("counter"), ...QUARTER)).curve.tier).toBe("day");
  expect(daily.asked).toEqual(["statistics day"]);
});

test("a status is a band of states and a held value a step line, from history at any range", async () => {
  const { reads, asked } = core({ history: RAW });

  expect((await readSeries(reads, series("status"), ...QUARTER)).curve.draw).toBe("states");
  expect((await readSeries(reads, series("held"), ...WEEK)).curve.draw).toBe("step");
  expect(asked.map((a) => a.split(" ")[0])).toEqual(["history", "history"]);
});

test("an extra stored before kinds is drawn as a measurement", async () => {
  const { reads } = core({ history: RAW });

  expect((await readSeries(reads, series(null), ...DAY)).curve.draw).toBe("line");
});

test("a status with more changes than a read holds says so", async () => {
  const { reads } = core({ history: { problem: "history.range" } });
  const got = await readSeries(reads, series("status"), ...QUARTER);

  expect(got.trouble).toBe("many");
  expect(got.curve.samples).toEqual([]);
});

test("a range the statistics refuse is no status with too many changes", async () => {
  const { reads } = core({ statistics: { problem: "history.range" } });

  expect((await readSeries(reads, series("measurement"), ...QUARTER)).trouble).toBe("failed");
});

test("a refused or unreachable read fails that series alone", async () => {
  const refused = core({ statistics: { problem: "auth.required" } });

  const offline: Reads = {
    history: () => Promise.reject(new TypeError("network")),
    statistics: () => Promise.reject(new TypeError("network")),
  };

  expect((await readSeries(refused.reads, series("measurement"), ...WEEK)).trouble).toBe("failed");
  expect((await readSeries(offline, series("measurement"), ...DAY)).trouble).toBe("failed");
});

test("a refused read keeps the core's reason; an unreachable one has none", async () => {
  const refused = core({ statistics: { problem: "auth.required" } });

  const offline: Reads = {
    history: () => Promise.reject(new TypeError("network")),
    statistics: () => Promise.reject(new TypeError("network")),
  };

  expect((await readSeries(refused.reads, series("measurement"), ...WEEK)).refused).toEqual({
    problem: "auth.required",
  });
  expect((await readSeries(offline, series("measurement"), ...DAY)).refused).toBeUndefined();
});

test("a day whose change points have expired reads hourly statistics and says so", async () => {
  const measured = core({ statistics: MEANS });
  const counted = core({ statistics: DELTAS });
  const got = await readSeries(measured.reads, series("measurement"), ...DAY);

  expect(measured.asked.map((a) => a.split(" ").slice(0, 2).join(" "))).toEqual([
    "history 3",
    "statistics hour",
  ]);
  expect(got.hourly).toBe(true);
  expect(got.curve.tier).toBe("hour");
  expect(got.curve.samples[0]).toEqual({ t0: ms(0), t1: ms(1), v: 10, lo: 4, hi: 21 });

  const bars = await readSeries(counted.reads, series("counter"), ...DAY);

  expect([bars.hourly, bars.curve.draw]).toEqual([true, "bars"]);
});

test("a day without readings or statistics is a gap, with nothing said", async () => {
  const { reads } = core({});
  const got = await readSeries(reads, series("measurement"), ...DAY);

  expect(got).toEqual({
    curve: { draw: "line", tier: "raw", samples: [] },
    hourly: false,
    trouble: null,
  });
});

test("the time before a series' first reading stays empty, unread", async () => {
  const { reads, asked } = core({ history: RAW, statistics: MEANS });
  const got = await readSeries(reads, series("measurement", "2026-11-11T00:00:00Z"), ...DAY);

  expect(asked).toEqual([]);
  expect(got.curve.samples).toEqual([]);
  expect(got.hourly).toBe(false);
});

test("a status or held value has nothing as old as a day read by the hour", () => {
  const none = { draw: "states", tier: "raw", samples: [] } as const;
  const hourly = { kind: "measurement", hourly: true, curve: { ...none, draw: "line" } } as const;
  const state = { kind: "status", hourly: false, curve: none } as const;

  expect(expired([hourly, state])).toBe(true);
  expect(expired([hourly, { ...state, kind: "held" }])).toBe(true);
  expect(expired([{ ...hourly, hourly: false }, state])).toBe(false);
  // It has readings that old after all.
  expect(
    expired([hourly, { ...state, curve: { ...none, samples: [{ t0: 0, t1: 1, v: 2 }] } }]),
  ).toBe(false);
  // A measurement's gap is no expiry.
  expect(expired([hourly, { ...state, kind: "measurement" }])).toBe(false);
});
