import { expect, test } from "bun:test";
import { dayOf } from "../range/calendar.ts";
import { rangeFor } from "../range/range.ts";
import { connect } from "../api/core.ts";
import { heatCells, heatColumns, readHeat } from "./heat.ts";

const H = 3_600_000;

const hourAt = (day: number, h: number) => new Date((day * 24 + h) * H).toISOString();

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

test("each hour's energy is its hourly rollup, read from the core in kWh", async () => {
  // Thursday, 1 October 2026; ten days later the whole week is past.
  const day = dayOf(2026, 9, 1);
  const place = { zone: "UTC", cal: { today: day + 10, hour: 12, last: day + 10 } };
  const asked: string[] = [];

  const core = connect({
    base: "http://core.test/",
    fetch: (request) => {
      const url = new URL(request.url);
      asked.push(`${url.pathname.split("/").at(-1)}:${url.searchParams.get("period")}`);

      return Promise.resolve(
        Response.json({
          period: "hour",
          points: [
            {
              date: "2026-10-01",
              start: hourAt(day, 10),
              end: hourAt(day, 11),
              integral: 2500,
              hours: 1,
            },
          ],
        }),
      );
    },
  });

  const source = { device: 1, series: "pv.power" };
  const heat = await readHeat(core, source, place, rangeFor("day", day));

  expect(asked).toEqual(["statistics:hour"]);
  expect(heat.cells[3]![10]).toBe(2.5);
  expect(heat.cells[3]![9]).toBeNull();
});
