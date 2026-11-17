/// <reference types="bun" />
import { expect, test } from "bun:test";
import { dayFacts } from "./ahead-facts.ts";

const HOUR = 3_600_000;

test("the best window reads by the plant's clock on the day the clocks go forward", () => {
  // 2026-03-29 in Berlin has 23 hours: 10:00 is nine hours after its midnight.
  const start = Date.parse("2026-03-28T23:00:00Z");

  const day = {
    start,
    end: start + 23 * HOUR,
    total: 20,
    remaining: null,
    peak: null,
    change: null,
    window: { from: start + 9 * HOUR, to: start + 12 * HOUR, kwh: 11 },
    lines: [],
  };

  expect(dayFacts(day, 4.5, "Europe/Berlin")).toEqual([
    { label: "Sonnenschein", value: 4.5, unit: "h", digits: 1 },
    { label: "Beste 3 h", text: "10–13 Uhr" },
  ]);
});

test("a day without sunshine stored and without sun has no facts", () => {
  const day = { start: 0, end: 24 * HOUR, total: 0, remaining: null, peak: null, change: null };

  expect(dayFacts({ ...day, window: null, lines: [] }, null, "UTC")).toEqual([]);
});
