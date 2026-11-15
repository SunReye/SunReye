import { expect, test } from "bun:test";
import { brushRange, edges } from "./edges.ts";
import { canStep, rangeFor, rangeLabel, spanRange, step, travel, type Calendar } from "./range.ts";
import { parseRange, rangeParams } from "./params.ts";

/** Thursday 2026-11-12 (day 20769), 14:00 at the plant; history reaches today. */
const CAL: Calendar = { today: 20_769, hour: 14, last: 20_769 };

const params = (query: string) => new URLSearchParams(query);

test("a route without a range shows the current month", () => {
  const range = parseRange(CAL, params(""));

  expect(range).toEqual({ kind: "month", from: 20_758, to: 20_788 });
  expect(rangeLabel(CAL, range)).toBe("November 2026");
});

test("a range survives the route both ways", () => {
  const week = rangeFor("week", 20_700);

  expect(rangeParams(CAL, week)).toEqual({ range: "week", at: "2026-08-31", from: null, to: null });
  expect(parseRange(CAL, params("range=week&at=2026-08-31"))).toEqual(week);

  const hours = spanRange(CAL, 20_768 * 24 + 8, 20_769 * 24 + 6);

  expect(rangeParams(CAL, hours)).toEqual({
    range: "custom",
    at: null,
    from: "2026-11-11T08",
    to: "2026-11-12T06",
  });
  expect(parseRange(CAL, params("range=custom&from=2026-11-11T08&to=2026-11-12T06"))).toEqual(
    hours,
  );
});

test("the current range keeps no anchor in the route", () => {
  expect(rangeParams(CAL, rangeFor("day", CAL.today))).toEqual({
    range: "day",
    at: null,
    from: null,
    to: null,
  });
});

test("a week runs Monday to Sunday and steps by whole weeks", () => {
  const week = rangeFor("week", CAL.today);

  expect(week).toEqual({ kind: "week", from: 20_766, to: 20_773 });
  expect(rangeLabel(CAL, week)).toBe("Diese Woche");

  const before = step(CAL, week, -1);

  expect(before).toEqual({ kind: "week", from: 20_759, to: 20_766 });
  expect(rangeLabel(CAL, before)).toBe("KW 45 · 2. Nov.–8. Nov.");
});

test("stepping stops at the last day the screen reaches", () => {
  expect(canStep(CAL, rangeFor("day", CAL.today), 1)).toBe(false);
  expect(canStep(CAL, rangeFor("day", CAL.today - 1), 1)).toBe(true);
  expect(canStep({ ...CAL, last: CAL.today + 2 }, rangeFor("day", CAL.today), 1)).toBe(true);
});

test("a custom range of hours steps by its own length", () => {
  const hours = spanRange(CAL, 20_760 * 24 + 8, 20_760 * 24 + 14);

  expect(rangeLabel(CAL, hours)).toBe("3. Nov. 2026 · 8–14 Uhr");
  expect(step(CAL, hours, -1)).toEqual({ kind: "custom", from: 20_760, to: 20_761, h0: 2, h1: 8 });
});

test("a day has an hour per band, a month a day per band, a year a month per band", () => {
  const day = edges(CAL, rangeFor("day", CAL.today));

  expect(day).toHaveLength(24);
  expect(day[14]).toMatchObject({ key: "b14", label: "14", title: "14–15 Uhr", state: "live" });
  expect(day[15]?.state).toBe("future");
  expect(day[13]?.state).toBe("past");

  const month = edges(CAL, rangeFor("month", CAL.today));

  expect(month).toHaveLength(30);
  expect(month[0]?.drill).toEqual({ kind: "day", from: 20_758, to: 20_759 });

  const year = edges(CAL, rangeFor("year", CAL.today));

  expect(year.map((e) => e.label)).toEqual([
    "Jan",
    "Feb",
    "Mär",
    "Apr",
    "Mai",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Okt",
    "Nov",
    "Dez",
  ]);
  expect(year[10]?.state).toBe("live");
});

test("a screen of daily figures shows a day as one band", () => {
  const day = edges(CAL, rangeFor("day", CAL.today), "day");

  expect(day).toHaveLength(1);
  expect(day[0]?.drill).toBeNull();
});

test("bands are keyed by place, so a step moves the same bands", () => {
  const now = edges(CAL, rangeFor("month", CAL.today)).map((e) => e.key);
  const before = edges(CAL, step(CAL, rangeFor("month", CAL.today), -1)).map((e) => e.key);

  expect(before.slice(0, 30)).toEqual(now);
});

test("a step morphs, a range inside the old one zooms in, and the reverse zooms out", () => {
  const month = rangeFor("month", CAL.today);
  const day = rangeFor("day", 20_763);

  expect(travel(month, step(CAL, month, -1), "step")).toMatchObject({ kind: "morph", dir: -1 });
  expect(travel(month, day, null)).toMatchObject({
    kind: "zoom",
    inward: true,
    a: 5 / 30,
    b: 6 / 30,
  });
  expect(travel(day, month, null)).toMatchObject({
    kind: "zoom",
    inward: false,
    a: 5 / 30,
    b: 6 / 30,
  });
  expect(travel(month, rangeFor("week", CAL.today), "kind")).toMatchObject({ kind: "morph" });
});

test("brushing across bands narrows to their hours, or to their whole days", () => {
  const day = rangeFor("day", 20_760);

  expect(brushRange(CAL, day, edges(CAL, day), 8, 11)).toEqual({
    kind: "custom",
    from: 20_760,
    to: 20_761,
    h0: 8,
    h1: 12,
  });

  const month = rangeFor("month", CAL.today);

  expect(brushRange(CAL, month, edges(CAL, month), 2, 4)).toEqual({
    kind: "custom",
    from: 20_760,
    to: 20_763,
  });
});
