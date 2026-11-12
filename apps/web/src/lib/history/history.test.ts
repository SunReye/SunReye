import { expect, test } from "bun:test";
import { bandFigure, choices, energy } from "./history.ts";

const DAY = { date: "2026-11-08", start: "2026-11-07T23:00:00Z", end: "2026-11-08T23:00:00Z" };

test("a period's energy is a counter's delta or a power's integral, in kWh", () => {
  expect(energy("pv.energy.total", { ...DAY, delta: 11.5 })).toBe(11.5);
  expect(energy("pv.mppt.power[2]", { ...DAY, mean: 500, integral: 12_000 })).toBe(12);
  expect(energy("battery.soc", { ...DAY, mean: 64, integral: 1536 })).toBeNull();
});

test("the plant comes first among the devices, each series sorted", () => {
  const devices = { "7": { "battery.soc": 64 }, "4294967294": { "pv.power": 1, "grid.power": 2 } };

  expect(choices(devices)).toEqual([
    { device: 4_294_967_294, series: ["grid.power", "pv.power"] },
    { device: 7, series: ["battery.soc"] },
  ]);
});

const H = 3_600_000;

test("a power series fills a band with its energy in kWh, split at the band's edges", () => {
  // 2 kW from 0 to 2 h, then −1 kW (export) to 4 h.
  const points = [
    { start: 0, end: 2 * H, mean: 2000 },
    { start: 2 * H, end: 4 * H, mean: -1000 },
  ];

  expect(bandFigure("grid.power", points, H, 3 * H)).toEqual({ value: 1, covered: 2 * H });
});

test("any other series fills a band with its time-weighted mean", () => {
  const points = [
    { start: 0, end: H, mean: 40 },
    { start: H, end: 4 * H, mean: 80 },
  ];

  expect(bandFigure("battery.soc", points, 0, 4 * H)).toEqual({ value: 70, covered: 4 * H });
  expect(bandFigure("battery.soc", points, 5 * H, 6 * H)).toEqual({ value: 0, covered: 0 });
});
