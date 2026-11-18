import { expect, test } from "bun:test";
import type { Rolled } from "../history/history.ts";
import { pvShareOf, sessionsOf, sessionTimes } from "./ev.ts";

const H = 3_600_000;
const DAY = Date.parse("2026-11-12T00:00:00Z");

/** The hour from `h` after midnight, charging `wh`. */
const hour = (h: number, wh: number): Rolled => ({
  start: DAY + h * H,
  end: DAY + (h + 1) * H,
  integral: wh,
  mean: wh,
  max: wh,
  covered: H,
});

test("consecutive charging hours are one session, an idle hour between them two", () => {
  const rolled = [hour(7, 3000), hour(8, 7000), hour(9, 0), hour(10, 4000), hour(11, 2500)];

  expect(sessionsOf(rolled, DAY + 12 * H)).toEqual([
    { start: DAY + 10 * H, end: DAY + 12 * H, kwh: 6.5 },
    { start: DAY + 7 * H, end: DAY + 9 * H, kwh: 10 },
  ]);
});

test("charging below the floor, or a missing hour, ends a session", () => {
  const rolled = [hour(1, 3000), hour(2, 20), hour(3, 3000), hour(5, 3000)];

  expect(sessionsOf(rolled, DAY + 12 * H).map((s) => s.kwh)).toEqual([3, 3, 3]);
});

test("a session still charging ends now, not at the end of its hour", () => {
  const now = DAY + 12 * H + 20 * 60_000;

  expect(sessionsOf([hour(11, 3000), hour(12, 1000)], now)).toEqual([
    { start: DAY + 11 * H, end: now, kwh: 4 },
  ]);
});

test("a range without charging has no sessions", () => {
  expect(sessionsOf([hour(1, 0), hour(2, 10)], DAY + 12 * H)).toEqual([]);
});

/** The plant's hours: its house load, what it bought and what its battery gave, in Wh. */
const plant = (
  hours: readonly (readonly [hour: number, load: number, bought: number, gave: number])[],
) => ({
  load: hours.map(([h, load]) => hour(h, load)),
  imported: hours.map(([h, , bought]) => hour(h, bought)),
  discharge: hours.map(([h, , , gave]) => hour(h, gave)),
});

test("the PV share weighs each hour's charge by the share of the house PV met directly then", () => {
  // 08:00 ran on PV alone, 22:00 on the grid alone: half the charge was PV's.
  const ev = [hour(8, 2000), hour(22, 2000)];

  expect(
    pvShareOf(
      ev,
      plant([
        [8, 4000, 0, 0],
        [22, 4000, 4000, 0],
      ]),
    ),
  ).toBeCloseTo(50);
  // The battery's part is not PV's.
  expect(pvShareOf([hour(20, 2000)], plant([[20, 4000, 0, 4000]]))).toBeCloseTo(0);
  // A third of 09:00 was bought.
  expect(pvShareOf([hour(9, 3000)], plant([[9, 6000, 2000, 0]]))).toBeCloseTo(66.7, 1);
});

test("an hour the plant read nothing in is left out; without such a charge there is no share", () => {
  expect(pvShareOf([hour(8, 2000), hour(9, 2000)], plant([[8, 4000, 0, 0]]))).toBeCloseTo(100);
  expect(pvShareOf([hour(9, 2000)], plant([[8, 4000, 0, 0]]))).toBeNull();
  expect(pvShareOf([hour(8, 0)], plant([[8, 4000, 0, 0]]))).toBeNull();
});

test("a session reads its clock times; past a day, its day first", () => {
  const s = { start: DAY + 22 * H, end: DAY + 26 * H + 15 * 60_000, kwh: 9 };

  expect(sessionTimes(s, false, "UTC")).toBe("22:00–2:15 Uhr");
  expect(sessionTimes(s, true, "Europe/Berlin")).toBe("12. Nov., 23:00–3:15 Uhr");
});
