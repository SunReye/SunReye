import { expect, test } from "bun:test";
import { dayOf } from "../range/calendar.ts";
import { rangeFor } from "../range/range.ts";
import { heatCells, heatColumns, hourly } from "./heat.ts";

const H = 3_600_000;

// Thursday, 12 November 2026, 12:00.
const TODAY = dayOf(2026, 10, 12);

test("a day's heat shows the week it lies in, a column per day", () => {
  const { by, cols } = heatColumns(rangeFor("day", TODAY));

  expect(by).toBe("day");
  expect(cols.map((c) => c.t0 / 24)).toEqual([0, 1, 2, 3, 4, 5, 6].map((i) => TODAY - 3 + i));
  expect(cols[3]!.drill).toEqual(rangeFor("day", TODAY));
});

test("past about two months the heat goes by month, the last 36 at most", () => {
  const year = heatColumns(rangeFor("year", TODAY));

  expect(year.by).toBe("month");
  expect(year.cols).toHaveLength(12);
  expect(year.cols[1]!.drill).toEqual(rangeFor("month", dayOf(2026, 1, 1)));

  const decade = heatColumns({ kind: "custom", from: dayOf(2016, 0, 1), to: TODAY + 1 });

  expect(decade.cols).toHaveLength(36);
  expect(decade.cols.at(-1)!.t0).toBe(dayOf(2026, 10, 1) * 24);
});

test("a cell is its hour's mean over the column's days; missing is null, not yet is NaN", () => {
  const cols = heatColumns(rangeFor("day", TODAY)).cols;

  const read = new Map([
    [(TODAY - 3) * 24 + 10, 1],
    [(TODAY - 3) * 24 + 11, 3],
    [TODAY * 24 + 10, 2],
  ]);

  const { cells, max } = heatCells(cols, (t) => read.get(t) ?? null, TODAY * 24 + 12);

  expect(cells[0]![10]).toBe(1);
  expect(cells[0]![9]).toBeNull();
  expect(cells[3]![10]).toBe(2);
  expect(cells[3]![12]).toBeNaN();
  expect(cells[6]![0]).toBeNaN();
  expect(max).toBe(3);
});

test("a month column averages its days' hours", () => {
  const cols = heatColumns(rangeFor("year", TODAY)).cols;
  const jan = dayOf(2026, 0, 1);

  const read = new Map([
    [jan * 24 + 12, 2],
    [(jan + 1) * 24 + 12, 4],
  ]);

  expect(heatCells(cols, (t) => read.get(t) ?? null, TODAY * 24).cells[0]![12]).toBe(3);
});

test("hourly energy is each hour's time-weighted mean power, in kWh", () => {
  const points = [
    { start: 0, end: H / 2, mean: 1000 },
    { start: H / 2, end: 2 * H, mean: 3000 },
  ];

  expect(hourly(points, [0, H, 2 * H, 3 * H], (w) => w)).toEqual([2, 3, null]);
  expect(hourly(points, [0, H], (w) => Math.max(0, -w))).toEqual([0]);
});
