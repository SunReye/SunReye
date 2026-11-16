import { expect, test } from "bun:test";
import { dayOf } from "../range/calendar.ts";
import { edges } from "../range/edges.ts";
import { hourInstant, rangeFor, type Calendar } from "../range/range.ts";
import { NO_PLANT, sumOf, type Plant } from "./flows.ts";
import type { Loaded } from "./stats.svelte.ts";
import { summaryOf } from "./summary.ts";

const ZONE = "UTC";
const DAY = dayOf(2026, 10, 3);
const CAL: Calendar = { today: DAY + 1, hour: 10, last: DAY + 1 };
const ms = (h: number) => hourInstant(ZONE, DAY * 24 + h).getTime();
const H = 3_600_000;

/** A day whose house load is read from 10 h on, but for 12–14 h. */
const PLANT: Plant = {
  ...NO_PLANT,
  load: [
    { start: new Date(ms(10)).toISOString(), end: new Date(ms(12)).toISOString(), mean: 1000 },
    { start: new Date(ms(14)).toISOString(), end: new Date(ms(24)).toISOString(), mean: 1000 },
  ],
  days: {
    ...NO_PLANT.days,
    load: [{ start: ms(0), end: ms(24), integral: 12_000, mean: 1000, max: 1000, covered: 12 * H }],
    pv: [{ start: ms(0), end: ms(24), integral: 5000, mean: 400, max: 4200, covered: 12 * H }],
  },
};

function loaded(kind: "day" | "week" = "day"): Loaded {
  const range = rangeFor(kind, DAY);
  const list = edges(CAL, range);
  const none = sumOf(NO_PLANT, 0, 0);

  return {
    range,
    via: { id: 1, kind: "none", a: 0, b: 1, inward: true, dir: 0 },
    cal: CAL,
    zone: ZONE,
    list,
    spans: list.map((e) => [hourInstant(ZONE, e.t0).getTime(), hourInstant(ZONE, e.t1).getTime()]),
    now: ms(30),
    plant: PLANT,
    sum: sumOf(PLANT, ms(0), ms(24)),
    days: null,
    money: null,
    cmp: "prev",
    base: {
      range: rangeFor("day", DAY - 1),
      hours: [DAY * 24 - 24, DAY * 24],
      sum: none,
      money: null,
      plant: NO_PLANT,
      days: null,
    },
  };
}

const VIEW = { metric: "plant", tab: "data", cmp: "prev", sid: null } as const;
const STRINGS = { rows: [], learning: null };

test("the time before the record began is no gap", () => {
  const s = summaryOf(loaded(), VIEW, STRINGS, ms(10));

  expect(s.gapHours).toBe(2);
  expect(s.notes.map((n) => n.text)).toEqual([expect.stringContaining("2 h")]);
  // 12 of the 14 hours since the record began.
  expect(s.breakdown.at(-1)?.value).toBeCloseTo((12 / 14) * 100);
});

test("a record older than the range leaves the range whole", () => {
  expect(summaryOf(loaded(), VIEW, STRINGS, ms(-500)).gapHours).toBe(12);
});

test("the first day's peak counts, though the record began after its midnight", () => {
  const peaks = summaryOf(loaded("week"), VIEW, STRINGS, ms(10)).peaks;

  expect(peaks.map((p) => [p.label, p.value])).toContainEqual(["PV-Leistung", 4200]);
});
