import { describe, expect, mock, test } from "bun:test";
import type { HistoryRange } from "./ranges";

// mock-hygiene-ignore-next-line -- a rune module: it cannot be compiled, so cannot be imported, under bun test. Each formatter tags its output so the test reads which one ran.
mock.module("$lib/display.svelte", () => ({
  display: {
    day: (d: Date) => `day(${d.toISOString()})`,
    time: (d: Date) => `time(${d.toISOString()})`,
    dayTime: (d: Date) => `dayTime(${d.toISOString()})`,
  },
}));

const { tooltipLabel, xTick } = await import("./chart-format");

const H = 3_600_000;
const FROM = new Date("2026-09-01T00:00:00Z");
const range = (over: Partial<HistoryRange> & { spanH?: number }): HistoryRange => ({
  id: "r",
  label: "r",
  live: false,
  from: FROM,
  to: new Date(FROM.getTime() + (over.spanH ?? 24) * H),
  bucket: "hour",
  ...over,
});
const V = new Date("2026-09-01T12:30:00Z");
const ISO = V.toISOString();

describe("tooltipLabel", () => {
  test("a day bucket is a date only", () => {
    expect(tooltipLabel(range({ bucket: "day" }), V)).toBe(`day(${ISO})`);
  });

  test("a finer bucket is date and time", () => {
    expect(tooltipLabel(range({ bucket: "hour" }), V)).toBe(`dayTime(${ISO})`);
    expect(tooltipLabel(range({ bucket: "minute" }), V)).toBe(`dayTime(${ISO})`);
  });

  test("accepts a timestamp number or an ISO string as well as a Date", () => {
    expect(tooltipLabel(range({}), V.getTime())).toBe(`dayTime(${ISO})`);
    expect(tooltipLabel(range({}), ISO)).toBe(`dayTime(${ISO})`);
  });
});

describe("xTick", () => {
  test("a live window is clock time", () => {
    expect(xTick(range({ live: true, bucket: "day" }), V)).toBe(`time(${ISO})`);
  });

  test("a day-bucket window is a date", () => {
    expect(xTick(range({ bucket: "day" }), V)).toBe(`day(${ISO})`);
  });

  test("a span up to 36 hours is clock time, the boundary included", () => {
    expect(xTick(range({ spanH: 24 }), V)).toBe(`time(${ISO})`);
    expect(xTick(range({ spanH: 36 }), V)).toBe(`time(${ISO})`);
  });

  test("a span past 36 hours is a date, so a repeated 00:00 stays unambiguous", () => {
    expect(xTick(range({ spanH: 37 }), V)).toBe(`day(${ISO})`);
    expect(xTick(range({ spanH: 24 * 7 }), V)).toBe(`day(${ISO})`);
  });
});
