import { expect, test } from "bun:test";
import { connect } from "../api/core.ts";
import { rangeFor } from "../range/range.ts";
import { bandFigure, periodOf, rollups } from "./history.ts";

const H = 3_600_000;
const DAY = 24 * H;

test("a power series fills a band with the energy of the rollups starting in it", () => {
  // 2 kWh, then 1 kWh fed in, then 3 kWh; the third hour half read.
  const hours = [
    { start: 0, end: H, integral: 2000, mean: 2000, covered: H },
    { start: H, end: 2 * H, integral: -1000, mean: -1000, covered: H },
    { start: 2 * H, end: 3 * H, integral: 3000, mean: 6000, covered: H / 2 },
  ];

  expect(bandFigure("grid.power", hours, H, 3 * H)).toEqual({ value: 2, covered: 1.5 * H });
});

test("any other series fills a band with its mean, weighted by the time each rollup was read", () => {
  const hours = [
    { start: 0, end: H, integral: 40, mean: 40, covered: H },
    { start: H, end: 4 * H, integral: 240, mean: 80, covered: 3 * H },
  ];

  expect(bandFigure("battery.soc", hours, 0, 4 * H)).toEqual({ value: 70, covered: 4 * H });
  expect(bandFigure("battery.soc", hours, 5 * H, 6 * H)).toEqual({ value: 0, covered: 0 });
});

test("a range of whole days reads day rollups, one cut inside a day or of hour bands hours", () => {
  expect(periodOf(rangeFor("week", 20_000))).toBe("day");
  expect(periodOf(rangeFor("year", 20_000))).toBe("day");
  expect(periodOf(rangeFor("day", 20_000))).toBe("hour");
  expect(periodOf({ kind: "custom", from: 20_000, to: 20_100, h0: 6 })).toBe("hour");
});

/** A core answering every statistics read with one rollup at its start, recording each read. */
function fake() {
  const asked: Readonly<{ period: string; from: number; to: number }>[] = [];

  const core = connect({
    base: "http://core.test/",
    fetch: (request) => {
      const q = new URL(request.url).searchParams;
      const [from, to] = [Date.parse(q.get("from") ?? ""), Date.parse(q.get("to") ?? "")];

      asked.push({ period: q.get("period") ?? "", from, to });

      const start = new Date(from).toISOString();
      const point = { date: "2026-01-01", start, end: start, integral: 5, mean: 5, hours: 0.5 };

      return Promise.resolve(Response.json({ period: q.get("period"), points: [point] }));
    },
  });

  return { asked, core };
}

test("a long range is read in pieces each tier serves, end to end", async () => {
  const { core, asked } = fake();
  const T0 = Date.parse("2016-01-01T00:00:00Z");

  const days = await rollups(core, 1, "pv.power", "day", new Date(T0), new Date(T0 + 3653 * DAY));
  const hours = await rollups(core, 1, "pv.power", "hour", new Date(T0), new Date(T0 + 90 * DAY));

  for (const [period, cap, end] of [
    ["day", 1498 * DAY, T0 + 3653 * DAY],
    ["hour", 1499 * H, T0 + 90 * DAY],
  ] as const) {
    const reads = asked.filter((a) => a.period === period);

    expect(reads.length).toBeGreaterThan(1);
    expect(reads.every((a) => a.to - a.from <= cap)).toBe(true);
    expect(reads[0]!.from).toBe(T0);
    expect(reads.at(-1)!.to).toBe(end);
    expect(reads.slice(1).every((a, i) => a.from === reads[i]!.to)).toBe(true);
  }

  expect(days[0]).toEqual({ start: T0, end: T0, integral: 5, mean: 5, covered: H / 2 });
  expect(hours).toHaveLength(asked.length - days.length);
});
