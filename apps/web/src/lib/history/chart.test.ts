import { expect, test } from "bun:test";
import { dayOf } from "../range/calendar.ts";
import { edges } from "../range/edges.ts";
import { hourInstant, rangeFor, type Calendar } from "../range/range.ts";
import { chartOf } from "./chart.ts";
import { NO_PLANT, sumOf, type Plant } from "./flows.ts";
import type { Rolled } from "./history.ts";
import type { Loaded } from "./stats.svelte.ts";

const ZONE = "UTC";
const DAY = dayOf(2026, 10, 3);
const CAL: Calendar = { today: DAY + 1, hour: 10, last: DAY + 1 };
const at = (h: number) => hourInstant(ZONE, DAY * 24 + h).toISOString();
const span = (h0: number, h1: number, mean: number) => ({ start: at(h0), end: at(h1), mean });
const H = 3_600_000;

/** Hourly rollups of a mean held from `h0` to before `h1`, read whole. */
function hourly(...spans: readonly (readonly [number, number, number])[]): Rolled[] {
  return spans.flatMap(([h0, h1, mean]) =>
    Array.from({ length: h1 - h0 }, (_, i) => ({
      start: Date.parse(at(h0 + i)),
      end: Date.parse(at(h0 + i + 1)),
      integral: mean,
      mean,
      max: mean,
      covered: H,
    })),
  );
}

const day = (h: number, wh: number): Rolled[] => [
  {
    start: Date.parse(at(h)),
    end: Date.parse(at(h + 24)),
    integral: wh,
    mean: wh / 24,
    max: null,
    covered: 24 * H,
  },
];

/** 10–12 h: 3 kW sun, 1 kW house, 2 kW out; 12–13 h unread; then 1 kW bought. */
const PLANT: Plant = {
  load: [span(10, 12, 1000), span(13, 24, 1000)],
  hours: {
    ...NO_PLANT.hours,
    pv: hourly([10, 12, 3000]),
    load: hourly([10, 12, 1000], [13, 24, 1000]),
    imported: hourly([13, 24, 1000]),
    exported: hourly([10, 12, 2000]),
    selfUsed: hourly([10, 12, 1000]),
    selfCovered: hourly([10, 12, 1000]),
  },
  days: {
    ...NO_PLANT.days,
    pv: day(0, 6000),
    load: day(0, 13_000),
    imported: day(0, 11_000),
    exported: day(0, 4000),
    selfUsed: day(0, 2000),
    selfCovered: day(0, 2000),
  },
};

/** The day before: 2 kW sun 10–11 h only. */
const BEFORE: Plant = {
  load: [span(-14, -13, 500)],
  hours: {
    ...NO_PLANT.hours,
    pv: hourly([-14, -13, 2000]),
    load: hourly([-14, -13, 500]),
    exported: hourly([-14, -13, 1500]),
    selfUsed: hourly([-14, -13, 500]),
    selfCovered: hourly([-14, -13, 500]),
  },
  days: {
    ...NO_PLANT.days,
    pv: day(-24, 2000),
    load: day(-24, 500),
    exported: day(-24, 1500),
    selfUsed: day(-24, 500),
    selfCovered: day(-24, 500),
  },
};

/** No readings the day before. */
const NOTHING_BEFORE = {
  plant: NO_PLANT,
  days: null,
};

function loaded(
  plant: Plant,
  days: Loaded["days"] = null,
  before: Readonly<{ plant: Plant; days: Loaded["days"] }> = NOTHING_BEFORE,
): Loaded {
  const range = rangeFor("day", DAY);
  const list = edges(CAL, range);
  const ms = (t: number) => hourInstant(ZONE, t).getTime();
  const [from, to] = [ms(DAY * 24), ms(DAY * 24 + 24)];

  return {
    range,
    via: { id: 1, kind: "none", a: 0, b: 1, inward: true, dir: 0 },
    cal: CAL,
    zone: ZONE,
    list,
    spans: list.map((e) => [ms(e.t0), ms(e.t1)] as const),
    now: to + 3_600_000,
    plant,
    sum: sumOf(plant, from, to),
    days,
    money: null,
    cmp: "prev",
    base: {
      range: rangeFor("day", DAY - 1),
      hours: [DAY * 24 - 24, DAY * 24],
      sum: sumOf(before.plant, from - 86_400_000, from),
      money: null,
      plant: before.plant,
      days: before.days,
    },
  };
}

test("energy: production above zero as self-used and fed in, the house below", () => {
  const chart = chartOf("energy", loaded(PLANT));
  const eleven = chart.bands[11]!;

  expect(eleven.up).toEqual([1, 2]);
  expect(eleven.down).toEqual([1, 0]);
  expect(chart.summary.up).toEqual([2, 4]);
  expect(chart.summary.down).toEqual([2, 11]);
});

test("an hour without readings is a gap; the night before readings began too", () => {
  const chart = chartOf("energy", loaded(PLANT));

  expect(chart.bands[12]!.state).toBe("gap");
  expect(chart.bands[3]!.state).toBe("gap");
  expect(chart.bands[14]!.state).toBe("data");
});

test("autarky: where each band's house load came from, in shares to 100 %", () => {
  const chart = chartOf("autarky", loaded(PLANT));

  expect(chart.max).toBe(100);
  expect(chart.bands[11]!.up).toEqual([100, 0]);
  expect(chart.bands[15]!.up).toEqual([0, 100]);
});

test("money comes by the day: savings above zero, the bill below", () => {
  const days = [{ start: at(0), end: at(24), paid: 3, earned: 1, saved: 4, standing: 0.5 }];

  const chart = chartOf("money", loaded(PLANT, days));

  expect(chart.bands).toHaveLength(1);
  expect(chart.bands[0]!.up).toEqual([3, 1]);
  expect(chart.bands[0]!.down).toEqual([3, 0.5]);
  expect(chart.down.map((s) => s.label)).toEqual(["Bezugskosten", "Grundpreis"]);
});

test("each bar carries the same band of the period before as its mark", () => {
  const chart = chartOf("energy", loaded(PLANT, null, { plant: BEFORE, days: null }));

  expect(chart.bands[10]!.mark).toBe(2);
  expect(chart.bands[11]!.mark).toBeNull();
  expect(chart.summary.mark).toBe(2);
});

test("money marks the savings of the day before; autarky has no mark", () => {
  const before = [{ start: at(-24), end: at(0), paid: 1, earned: 1, saved: 2.5, standing: 0 }];

  const got = loaded(
    PLANT,
    [{ start: at(0), end: at(24), paid: 3, earned: 1, saved: 4, standing: 0 }],
    {
      plant: BEFORE,
      days: before,
    },
  );

  expect(chartOf("money", got).bands[0]!.mark).toBe(2.5);

  expect(chartOf("autarky", got).bands.every((b) => b.mark === null)).toBe(true);
});

test("the bands before the record began are before it, not gaps", () => {
  const began = Date.parse(at(10));
  const bands = chartOf("energy", loaded(PLANT), began).bands;

  expect(bands.slice(0, 10).map((b) => b.state)).toEqual(
    Array.from({ length: 10 }, () => "before"),
  );
  expect(bands[10]?.state).toBe("data");
  // An hour without readings after the record began stays a gap.
  expect(bands[12]?.state).toBe("gap");
});
