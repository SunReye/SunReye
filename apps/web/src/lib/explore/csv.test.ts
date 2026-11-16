import { expect, test } from "bun:test";
import { rangeFor } from "../range/range.ts";
import { dayOfIso } from "../range/calendar.ts";
import { csvOf, foldTable, overlayTable, seriesTable } from "./csv.ts";
import type { Curve } from "./curve.ts";
import { rowsOf } from "./fold.ts";

const DAY = rangeFor("day", dayOfIso("2026-11-15"));
const WEEK = rangeFor("week", dayOfIso("2026-11-15"));

const at = (time: string) => Date.parse(`2026-11-15T${time}:00Z`);

const span = (from: string, to: string, v: number) => ({ t0: at(from), t1: at(to), v });

const chosen = (device: number, series: string, unit: string | null) => ({
  ref: { device, series },
  unit,
});

const MINUTES: Curve = {
  draw: "line",
  tier: "bucket",
  width: 60,
  samples: [span("00:00", "00:01", 1500.5), span("00:01", "00:02", -20)],
};

test("series: a row per point with its UTC start and end, a column per series by id and unit", () => {
  const load: Curve = { ...MINUTES, samples: [span("00:01", "00:02", 300)] };

  const table = seriesTable(DAY, [
    { chosen: chosen(4294967294, "pv.power", "W"), curve: MINUTES },
    { chosen: chosen(1, "pv.power", "W"), curve: load },
  ]);

  expect(table?.file).toBe("sunreye-2026-11-15-bucket60.csv");
  expect(csvOf(table!)).toBe(
    [
      "start,end,4294967294:pv.power [W],1:pv.power [W]",
      "2026-11-15T00:00:00Z,2026-11-15T00:01:00Z,1500.5,",
      "2026-11-15T00:01:00Z,2026-11-15T00:02:00Z,-20,300",
      "",
    ].join("\n"),
  );
});

test("series: mixed tiers keep each point's own interval, and the file names both", () => {
  const status: Curve = {
    draw: "states",
    tier: "raw",
    samples: [span("00:00", "00:01", 2), span("00:01", "06:30", 3)],
  };

  const table = seriesTable(DAY, [
    { chosen: chosen(1, "pv.power", "W"), curve: MINUTES },
    { chosen: chosen(1, "inverter.status", null), curve: status },
  ]);

  expect(table?.file).toBe("sunreye-2026-11-15-raw-bucket60.csv");
  expect(csvOf(table!)).toBe(
    [
      "start,end,1:pv.power [W],1:inverter.status",
      "2026-11-15T00:00:00Z,2026-11-15T00:01:00Z,1500.5,2",
      "2026-11-15T00:01:00Z,2026-11-15T00:02:00Z,-20,",
      "2026-11-15T00:01:00Z,2026-11-15T06:30:00Z,,3",
      "",
    ].join("\n"),
  );
});

test("series: a longer range is named by its first and last day; a band exports its min and max", () => {
  const hours: Curve = {
    draw: "line",
    tier: "hour",
    samples: [{ ...span("00:00", "01:00", 200), lo: 150, hi: 250 }],
  };

  const table = seriesTable(WEEK, [
    { chosen: chosen(1, "grid.voltage", "V"), curve: hours },
    { chosen: chosen(1, "pv.power", "W"), curve: MINUTES },
  ]);

  expect(table?.file).toBe("sunreye-2026-11-09_2026-11-15-bucket60-hour.csv");
  // A line without a band has no extremes to export.
  expect(csvOf(table!)).toBe(
    [
      "start,end,1:grid.voltage [V],1:grid.voltage min [V],1:grid.voltage max [V],1:pv.power [W]",
      "2026-11-15T00:00:00Z,2026-11-15T00:01:00Z,,,,1500.5",
      "2026-11-15T00:00:00Z,2026-11-15T01:00:00Z,200,150,250,",
      "2026-11-15T00:01:00Z,2026-11-15T00:02:00Z,,,,-20",
      "",
    ].join("\n"),
  );
});

test("a series id with a comma or a quote is quoted", () => {
  const table = seriesTable(DAY, [{ chosen: chosen(1, 'extra.fan "a", b', null), curve: MINUTES }]);

  expect(csvOf(table!).split("\n")[0]).toBe('start,end,"1:extra.fan ""a"", b"');
});

test("with no point plotted there is nothing to export", () => {
  const none: Curve = { draw: "line", tier: "raw", samples: [] };

  expect(seriesTable(DAY, [{ chosen: chosen(1, "pv.power", "W"), curve: none }])).toBeNull();
  expect(
    overlayTable(DAY, chosen(1, "pv.power", "W"), [{ key: "2026-11-15", curve: none }]),
  ).toBeNull();
  expect(foldTable(DAY, chosen(1, "pv.power", "W"), "hour", false, [])).toBeNull();
});

test("overlay: a column per period by its first day, on the range's clock", () => {
  const before: Curve = { ...MINUTES, samples: [span("00:00", "00:01", 900)] };

  const table = overlayTable(DAY, chosen(1, "pv.power", "W"), [
    { key: "2026-11-15", curve: MINUTES },
    { key: "2026-11-14", curve: before },
  ]);

  expect(table?.file).toBe("sunreye-2026-11-15-bucket60.csv");
  expect(csvOf(table!)).toBe(
    [
      "start,end,1:pv.power 2026-11-15 [W],1:pv.power 2026-11-14 [W]",
      "2026-11-15T00:00:00Z,2026-11-15T00:01:00Z,1500.5,900",
      "2026-11-15T00:01:00Z,2026-11-15T00:02:00Z,-20,",
      "",
    ].join("\n"),
  );
});

test("fold by day: the plant-local date beside the bounds, the mean with its min and max; a period without is blank", () => {
  const rows = rowsOf([
    {
      date: "2026-11-10",
      start: "2026-11-09T23:00:00Z",
      end: "2026-11-10T23:00:00Z",
      mean: 400.25,
      min: 0,
      max: 3000,
    },
    { date: "2026-11-11", start: "2026-11-10T23:00:00Z", end: "2026-11-11T23:00:00Z", hours: 0 },
  ]);

  const table = foldTable(WEEK, chosen(1, "pv.power", "W"), "day", false, rows);

  expect(table?.file).toBe("sunreye-2026-11-09_2026-11-15-day.csv");
  expect(csvOf(table!)).toBe(
    [
      "start,end,date,1:pv.power [W],1:pv.power min [W],1:pv.power max [W]",
      "2026-11-09T23:00:00Z,2026-11-10T23:00:00Z,2026-11-10,400.25,0,3000",
      "2026-11-10T23:00:00Z,2026-11-11T23:00:00Z,2026-11-11,,,",
      "",
    ].join("\n"),
  );
});

test("fold by hour: no date column; a counter exports its delta", () => {
  const rows = rowsOf([
    { date: "2026-11-15", start: "2026-11-15T00:00:00Z", end: "2026-11-15T01:00:00Z", delta: 1.5 },
  ]);

  const table = foldTable(DAY, chosen(1, "pv.energy.total", "kWh"), "hour", true, rows);

  expect(table?.file).toBe("sunreye-2026-11-15-hour.csv");
  expect(csvOf(table!)).toBe(
    ["start,end,1:pv.energy.total [kWh]", "2026-11-15T00:00:00Z,2026-11-15T01:00:00Z,1.5", ""].join(
      "\n",
    ),
  );
});
