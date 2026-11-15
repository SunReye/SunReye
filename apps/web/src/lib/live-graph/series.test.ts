/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { pointsOf, record, KEEP_MS } from "./series.ts";

const at = 1_700_000_000_000;

describe("record", () => {
  test("adds a point per power value of every device at the frame's time", () => {
    const series = record({}, { devices: { "7": { "pv.power": 1200, "battery.soc": 80 } } }, at);

    expect(pointsOf(series, 7, "pv.power")).toEqual([{ t: at, v: 1200 }]);
    expect(pointsOf(series, 7, "battery.soc")).toEqual([]);
  });

  test("appends later frames in time order", () => {
    const first = record({}, { devices: { "7": { "grid.power": -300 } } }, at);
    const next = record(first, { devices: { "7": { "grid.power": 250 } } }, at + 1000);

    expect(pointsOf(next, 7, "grid.power")).toEqual([
      { t: at, v: -300 },
      { t: at + 1000, v: 250 },
    ]);
  });

  test("a stale value is no new sample", () => {
    const series = record(
      {},
      { devices: { "7": { "pv.power": 900 } }, stale: { "7": { "pv.power": at - 60_000 } } },
      at,
    );

    expect(pointsOf(series, 7, "pv.power")).toEqual([]);
  });

  test("a lost stream adds nothing", () => {
    const series = record({}, { devices: { "7": { "pv.power": 900 } }, lost: at }, at);

    expect(pointsOf(series, 7, "pv.power")).toEqual([]);
  });

  test("drops points older than the window plus its buffer", () => {
    const old = record({}, { devices: { "7": { "pv.power": 1 } } }, at);
    const now = record(old, { devices: { "7": { "pv.power": 2 } } }, at + KEEP_MS + 1);

    expect(pointsOf(now, 7, "pv.power")).toEqual([{ t: at + KEEP_MS + 1, v: 2 }]);
  });

  test("the kept span covers two minutes and six intervals of the slowest feed", () => {
    expect(KEEP_MS).toBe(150_000);
  });
});
